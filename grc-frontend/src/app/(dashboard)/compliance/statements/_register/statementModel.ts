// The rules of the Statements register, apart from React so `node --test` can pin them (statementModel.test.ts): the row the list sends, what a statement is called, the quick views and
// what each counts, the order of the list, the search, who may assess (what the old drawer knew), what "Convert to controls" may take, and which evidence a save adds.
// A statement is a clause of a policy document; its compliance record (status, findings) belongs to the compliance module and its rights follow the document (statements.py).
import { statusLabel } from '../../../../../lib/format.ts';

/** One row of GET /compliance/policies/statements. */
export interface StatementRow {
  id: number;
  tenant_id: number;
  document_id: number;
  document_title: string | null;
  document_code: string | null;
  statement_code: string | null;
  statement_text: string | null;
  statement_summary: string | null;
  category: string | null;
  sub_category: string | null;
  priority: string | null;
  is_mandatory: boolean;
  status: string | null;
  effective_date: string | null;
  review_date: string | null;
  source_section: string | null;
  ai_confidence: number | null;
  compliance_status: string;
  compliance_score: number | null;
  next_assessment_date: string | null;
  assigned_to_user_id: number | null;
  assignee_name: string | null;
  created_at: string | null;
}

/** The value of "no category / no priority / nobody" in the facets that offer it. */
export const NONE = 'none';

/** The words of a statement: its summary, else the start of its text (the old page cut at 80 characters; the list clamps to two lines, so a longer start is kept), else nothing to read. */
export function statementTitle(row: Pick<StatementRow, 'statement_summary' | 'statement_text'>): string {
  const summary = (row.statement_summary ?? '').trim();
  if (summary) return summary;
  const text = (row.statement_text ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return 'No text';
  return text.length > 160 ? `${text.slice(0, 160).trimEnd()}…` : text;
}

export const categoryKey = (row: Pick<StatementRow, 'category'>): string => (row.category ?? '').trim() || NONE;
const ACRONYMS: Record<string, string> = { hr: 'HR', it: 'IT' };
export const categoryLabel = (key: string): string => (key === NONE ? 'No category' : ACRONYMS[key.toLowerCase()] ?? statusLabel(key));
export const priorityKey = (row: Pick<StatementRow, 'priority'>): string => (row.priority ?? '').trim().toLowerCase() || NONE;
export const assigneeKey = (row: Pick<StatementRow, 'assigned_to_user_id'>): string => (row.assigned_to_user_id == null ? NONE : String(row.assigned_to_user_id));
export const documentName = (row: Pick<StatementRow, 'document_title' | 'document_code' | 'document_id'>): string =>
  (row.document_title ?? '').trim() || (row.document_code ?? '').trim() || `Document ${row.document_id}`;

// ── the quick views ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const QUICK_IDS = ['all', 'mine', 'not_assessed', 'non_compliant', 'unassigned'] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const QUICK_LABEL: Record<QuickId, string> = { all: 'All', mine: 'Assigned to me', not_assessed: 'Not assessed', non_compliant: 'Non-compliant', unassigned: 'Unassigned' };
export interface Viewer { me: number | null }

export function inQuick(id: QuickId, row: StatementRow, v: Viewer): boolean {
  switch (id) {
    case 'all': return true;
    case 'mine': return v.me != null && row.assigned_to_user_id === v.me;
    case 'not_assessed': return row.compliance_status === 'not_assessed';
    case 'non_compliant': return row.compliance_status === 'non_compliant';
    case 'unassigned': return row.assigned_to_user_id == null;
    default: return false;
  }
}

// ── the order of the list ────────────────────────────────────────────────────────────────────────────────────────────────
export const SORT_KEYS = ['newest', 'code', 'priority', 'status', 'document'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
/** The server's own order was newest first. */
export const DEFAULT_SORT: Sort = { key: 'newest', dir: 'desc' };
export const SORT_LABEL: Record<SortKey, string> = { newest: 'Newest', code: 'Code', priority: 'Priority', status: 'Status', document: 'Document' };
export const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { newest: 'desc', code: 'asc', priority: 'asc', status: 'asc', document: 'asc' };

/** The next order when a header is pressed: a new column starts in its first direction, the same column turns round, a second turn goes back to the default. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  if (current.dir === FIRST_DIR[key]) return { key, dir: FIRST_DIR[key] === 'asc' ? 'desc' : 'asc' };
  return DEFAULT_SORT;
}

// worst first / most pressing first, as a person works down a list
const STATUS_ORDER = ['non_compliant', 'partially_compliant', 'not_assessed', 'compliant', 'not_applicable'];
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
const rank = (order: readonly string[], v: string): number => { const at = order.indexOf(v); return at < 0 ? order.length : at; };

/** The statements in the order asked for; one without the value goes last whichever way the column runs; ties fall back to the newest first. */
export function sortRows(rows: readonly StatementRow[], sort: Sort): StatementRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (r: StatementRow): string | number | null => {
    switch (sort.key) {
      case 'code': return (r.statement_code ?? '').trim() || null;
      case 'priority': { const k = priorityKey(r); return k === NONE ? null : rank(PRIORITY_ORDER, k); }
      case 'status': return rank(STATUS_ORDER, r.compliance_status);
      case 'document': return documentName(r).toLowerCase();
      default: return r.id;
    }
  };
  const newest = (a: StatementRow, b: StatementRow) => b.id - a.id;
  return rows.slice().sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return newest(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return newest(a, b);
    if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y, undefined, { numeric: true }) * sign || newest(a, b);
    return ((x as number) < (y as number) ? -1 : 1) * sign;
  });
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the search looks at: the code, the summary and the text, the document and its code, the category and the assignee (the old search looked at three of these, in 20 rows). */
export const haystack = (r: StatementRow): string =>
  `${r.statement_code ?? ''} ${r.statement_summary ?? ''} ${r.statement_text ?? ''} ${r.document_title ?? ''} ${r.document_code ?? ''} ${categoryLabel(categoryKey(r))} ${r.assignee_name ?? ''}`.toLowerCase();

export const searchTerms = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

// ── who may do what (the half of the server's rule the screen can know) ────────────────────────────────────────────────
/** The server lets a person assess, link evidence or reassign when the statement is unassigned, or the person is its assignee, or an administrator (and, besides, the assignee or someone who
 *  may edit the document: the screen cannot know that half, so a refusal is said in the server's words). This is the first half, as the old drawer had it. */
export function mayAssess(assignedTo: number | null | undefined, me: number | null, isAdmin: boolean): boolean {
  return assignedTo == null || isAdmin || (me !== null && assignedTo === me);
}

/** "Convert to controls" takes statements of ONE document (the server converts a document's statements). */
export interface ConvertPlan { documentId: number | null; documents: number; count: number; ok: boolean; why: string | null }
export function convertPlan(rows: readonly Pick<StatementRow, 'document_id'>[]): ConvertPlan {
  const ids = Array.from(new Set(rows.map((r) => r.document_id)));
  const ok = ids.length === 1;
  return {
    documentId: ok ? ids[0] : null, documents: ids.length, count: rows.length, ok,
    why: ids.length > 1 ? `These statements come from ${ids.length} different documents. Select statements from one document.` : null,
  };
}

/** The evidence a save adds: what was picked that is not linked yet (the server only ever adds; it has no way to take a link off). */
export function evidenceToAdd(picked: readonly number[], linked: readonly number[]): number[] {
  return picked.filter((id, i) => picked.indexOf(id) === i && linked.indexOf(id) < 0);
}

/** The next assessment date as the date input holds it ("2026-11-30"), from the server's "2026-11-30T00:00:00". */
export const dayOf = (iso: string | null | undefined): string => (iso ?? '').slice(0, 10);
