// Internal Audit's list, apart from React so `node --test` pins it (auditsModel.test.ts): which assessments are internal audits, where one opens, how its observations read, and the order.
// An internal audit is an assessment of the format "UBL audit master tracking" (the audit master workbook, one row per observation); the Assessments register lists every kind, this page
// lists these. Rows come from GET /compliance/assessments?assessment_format=ubl_audit_master_tracking (the server's true `total` says when the list is cut).
import type { ListRow } from '../../../assessments/_data/types.ts';
import type { SortState, SortValue } from '../../../../../components/ui/ds/tableModel.ts';

export type { ListRow };

/** The format of an internal audit (assessments/_forward/forwardModel.ts maps the old Internal Audit address to it). */
export const INTERNAL_AUDIT_FORMAT = 'ubl_audit_master_tracking';
/** The most audits asked for: a handful a year in practice; the page says when the server holds more. */
export const LIMIT = 200;

/** Where an audit opens: the assessment workspace, where its observations are worked through. */
export const workspaceHref = (id: number): string => `/assessments/a/${id}`;

export interface AuditNumbers { total: number | null; notComplied: number; partial: number; inProgress: number }

/** The observations of one audit as the workbook recorded them: how many, and how many are not complied, partly complied or still in progress. A count the server did not send is 0, a total it did not send is unknown. */
export const numbersOf = (r: Pick<ListRow, 'total_items' | 'not_complied_count' | 'partially_complied_count' | 'in_progress_count'>): AuditNumbers => ({
  total: typeof r.total_items === 'number' ? r.total_items : null,
  notComplied: r.not_complied_count ?? 0,
  partial: r.partially_complied_count ?? 0,
  inProgress: r.in_progress_count ?? 0,
});

/** What the sort of a column compares. */
export function sortValue(r: ListRow, key: string): SortValue {
  switch (key) {
    case 'name': return r.name;
    case 'status': return r.status;
    case 'assessor': return r.assessor;
    case 'due': return r.due_date;
    case 'items': return r.total_items;
    case 'updated': return r.updated_at ?? r.created_at;
    default: return null;
  }
}

/** The order the page opens in: the audit changed most recently first. */
export const DEFAULT_SORT: SortState = { key: 'updated', dir: 'desc' };

/** The answer's rows (only the ones that really are internal audits: a server that ignored the filter would list every assessment), and the true total. */
export function auditsOf(answer: { assessments?: ListRow[]; total?: number } | null | undefined): { rows: ListRow[]; total: number } {
  const rows = (Array.isArray(answer?.assessments) ? answer!.assessments! : []).filter((r) => r.assessment_format === INTERNAL_AUDIT_FORMAT);
  return { rows, total: typeof answer?.total === 'number' ? Math.max(answer.total, rows.length) : rows.length };
}
