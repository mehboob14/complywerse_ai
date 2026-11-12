// The document figures of the Governance Overview, in one place and without React, so `node --test` checks them (_model.test.ts): the shape the server answers
// (GET /governance/document-overview, backend modules/governance/documents_overview.py), the library address every figure opens, the words and
// the bars, and what a failed request says. The components only draw what this decides.
//
// Every figure is a link to the library already filtered (`links` in the answer holds its parameters, in the library's own vocabulary:
// libraryModel.ts PARAM_KEYS); a figure the server gave no address is plain text. A number the library cannot reproduce exactly says so in its (i).
import { formatCount, formatDateTime } from '../../../../../lib/format.ts';
import { documentStatus } from '../../../../../lib/status.ts';
import { REVIEW_BUCKET_LABEL, STAGE_ORDER } from '../../documents/_workspace/libraryModel.ts';

// ─── What the server answers ───────────────────────────────────────────────────────────────────────────────────────────────

export interface Choice {
  /** the address value (`?dept=`): "" the whole organisation, "none" no department, else the department's id */
  value: string;
  department_id: number | null;
  name: string;
  /** the names from the top department down to this one */
  path: string[];
  level: number;
  level_label: string;
  is_active: boolean;
}

export interface Scope {
  value: string;
  department_id: number | null;
  name: string;
  path: string[];
  level: number;
  level_label: string;
  whole_organisation: boolean;
  includes_below: boolean;
}

export interface Totals { documents: number; in_force: number; in_progress: number; expired: number; exception_applied: number; archived: number }
export interface TypeRow { key: string; doc_type: string; label: string; count: number; in_force: number; in_force_key: string }
export interface StatusRow { key: string; status: string; count: number }
/** One department of the scope: what is filed in it and under it (documents_overview.py `_by_department`); `own` is what is filed in it alone. */
export interface DepartmentRow {
  key: string;
  /** null: "No department" */
  department_id: number | null;
  name: string;
  path: string[];
  level: number;
  level_label: string;
  /** how far under the top row of the table (0 for the scope itself, or for a top department) */
  depth: number;
  is_active: boolean;
  owner: string | null;
  own: number;
  documents: number;
  in_force: number;
  in_progress: number;
  overdue_reviews: number;
  issues: number;
  /** the documents in it and below it by status and by type (only the ones that are there; a document with no type is under "") */
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  /** requests asked of people for those documents, by kind: pending, and how many of them are overdue (people asked, as in `requests`) */
  waiting: Record<RequestKind, { pending: number; overdue: number }>;
  /** where the review dates of the documents that owe a review stand */
  reviews: { overdue: number; due_soon: number; unscheduled: number };
  /** documents with each of these issues (a document can have several) */
  issues_by: { stuck: number; on_hold: number; late_approvals: number; late_acknowledgements: number; no_owner: number };
}
export type RequestKind = 'review' | 'approval' | 'acknowledgement';
export interface RequestFigures { pending: number; overdue: number; due_soon: number; oldest_days_late: number | null }
export interface WaitingRow {
  document_id: number;
  title: string;
  kind: RequestKind;
  stage: string;
  waiting_for: string[];
  waiting_count: number;
  due_date: string;
  days_late: number;
}
export interface Reviews { overdue: number; due_soon: number; unscheduled: number; up_to_date: number }
export interface Issues {
  no_owner: number;
  expired: number;
  exception_applied: number;
  stuck: number;
  on_hold: number;
  late_acknowledgements: number;
  late_approvals: number;
  /** documents with at least one of the issues above (each counted once) */
  documents: number;
}
export type Links = Record<string, Record<string, string>>;

export interface Overview {
  scope: Scope;
  choices: Choice[];
  as_of: string;
  totals: Totals;
  by_type: TypeRow[];
  by_status: StatusRow[];
  by_department: DepartmentRow[];
  requests: Record<RequestKind, RequestFigures>;
  waiting: WaitingRow[];
  reviews: Reviews;
  issues: Issues;
  links: Links;
}

// ─── Addresses ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const LIBRARY = '/governance/documents';
/** The Overview itself: the old At a glance address (/governance/documents/overview) forwards here. */
export const OVERVIEW = '/governance';
export const ENDPOINT = '/governance/document-overview';
/** The address key that carries the scope, here and in the library. */
export const DEPT = 'dept';

/** The library with these parameters (as the server's `links` give them); null when there are none to open: the figure is plain text. */
export function libraryHref(params: Readonly<Record<string, string>> | null | undefined): string | null {
  if (!params) return null;
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== '') q.set(key, value); });
  const text = q.toString();
  return text ? `${LIBRARY}?${text}` : LIBRARY;
}

/** Where a figure opens: the library filtered as the server says for this key. */
export const figureHref = (data: Pick<Overview, 'links'>, key: string): string | null => libraryHref(data.links[key]);

/** A document in the library's side panel. */
export const openHref = (id: number): string => `${LIBRARY}?open=${id}`;

/** The request parameters of the scope in the address: nothing asks for the server's own default (the whole organisation, or a head's first department). */
export const scopeParams = (dept: string): Record<string, string> => (dept.trim() ? { department_id: dept.trim() } : {});

/** The overview of the scope the person picked, as an address of this page. */
export const overviewHref = (value: string): string => (value ? `${OVERVIEW}?${DEPT}=${encodeURIComponent(value)}` : OVERVIEW);

// ─── The scope picker ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the picker says for a choice: a department by its whole path ("Operations › Support"), so two units of one name can be told apart. */
export const choiceLabel = (c: Pick<Choice, 'name' | 'path' | 'is_active'>): string =>
  (c.path.length ? c.path.join(' › ') : c.name) + (c.is_active ? '' : ' (inactive)');

/** The picker's options, in the server's order (tree order, "Whole organisation" first, "No department" last). */
export const scopeOptions = (choices: readonly Choice[]): { value: string; label: string }[] => choices.map((c) => ({ value: c.value, label: choiceLabel(c) }));

/** The choice the answer says it is for (the picker's value), else what the address asked for. */
export const pickedValue = (data: Pick<Overview, 'scope'> | undefined, dept: string): string => data?.scope.value ?? dept;

// ─── Words and bars ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How long ago something was due, compact for a table cell and in words for a tooltip or a screen reader. `days` counts whole days: 0 is under a day. */
export function lateBy(days: number): { short: string; long: string } {
  const n = Math.max(0, Math.floor(days));
  if (n < 1) return { short: '<1 d', long: 'Less than a day late' };
  if (n < 60) return { short: `${n} d`, long: `${n} ${n === 1 ? 'day' : 'days'} late` };
  if (n < 365) { const m = Math.round(n / 30.44); return { short: `${m} mo`, long: `${m} months late` }; }
  const y = Math.round((n / 365) * 2) / 2;
  return { short: `${y} y`, long: `${y} ${y === 1 ? 'year' : 'years'} late` };
}

/** "As of 4 Nov 2026, 14:05" (the server's time is naive UTC: the viewer's own clock). */
export const asOfText = (asOf: string): string => `As of ${formatDateTime(asOf)}`;

/** "3 overdue reviews. Open in the library": what a figure's link is called for a screen reader. */
export const figureName = (n: number, noun: string): string => `${formatCount(n)} ${noun}. Open in the library`;

// ─── The tone of a figure ──────────────────────────────────────────────────────────────────────────────────────────────────

export type Tone = 'default' | 'success' | 'warning' | 'danger';

/** Nothing to show: no document in this scope, not even an archived one. */
export const isEmpty = (d: Pick<Overview, 'totals'>): boolean => d.totals.documents === 0 && d.totals.archived === 0;

// ─── By department ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The address value of a row's department (what `?dept=` takes): its id, or "none" for the documents in no department. */
export const rowValue = (row: Pick<DepartmentRow, 'department_id'>): string => (row.department_id === null ? 'none' : String(row.department_id));
/** The row is the department the page is about (the scope itself). */
export const rowIsHere = (row: Pick<DepartmentRow, 'department_id'>, scope: Pick<Scope, 'department_id'>): boolean => row.department_id !== null && row.department_id === scope.department_id;

/** The table is worth a card on the summary when there is more than one row to compare: a unit with nothing under it is the six figures above. */
export const hasDepartmentTable = (d: Pick<Overview, 'by_department'>): boolean => d.by_department.length > 1;

// ─── By status ──────────────────────────────────────────────────────────────────────────────────────────

export interface Step { key: string; status: string; label: string; noun: string; count: number; href: string | null }

const stepOf = (d: Pick<Overview, 'by_status' | 'links'>, status: string): Step => {
  const row = d.by_status.find((s) => s.status === status);
  const label = documentStatus.label(status);
  return { key: `status:${status}`, status, label, noun: `documents with status ${label}`, count: row?.count ?? 0, href: figureHref(d, `status:${status}`) };
};

/** The five steps of the approval flow with their counts, in order (a step nobody is at says 0). */
export const flow = (d: Pick<Overview, 'by_status' | 'links'>): Step[] => STAGE_ORDER.map((s) => stepOf(d, s));

/** Where documents are that are not in the flow: expired and under an exception always, any other status only while some document has it. */
export function lapsed(d: Pick<Overview, 'by_status' | 'links'>): Step[] {
  const known = new Set<string>([...STAGE_ORDER, 'archived']);
  const others = d.by_status.filter((s) => !known.has(s.status) && s.status !== 'expired' && s.status !== 'exception_applied' && s.count > 0).map((s) => s.status);
  return ['expired', 'exception_applied', ...others].map((s) => stepOf(d, s));
}

// ─── Waiting on people ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const REQUEST_LABEL: Record<RequestKind, string> = { review: 'Review', approval: 'Approval', acknowledgement: 'Acknowledgement' };
export const REQUEST_KINDS: readonly RequestKind[] = ['review', 'approval', 'acknowledgement'];
/** How soon a request counts as due soon (the server's DUE_SOON_DAYS). */
export const DUE_SOON_DAYS = 7;

export interface RequestRow {
  kind: RequestKind;
  label: string;
  pending: number;
  overdue: number;
  dueSoon: number;
  /** "12 d", or null when nothing is overdue */
  oldest: string | null;
  oldestLong: string | null;
  pendingHref: string | null;
  overdueHref: string | null;
}

/** One block for each kind of request. Due soon has no address (the library cannot filter on it), and neither has a pending acknowledgement. */
export function requestRows(d: Pick<Overview, 'requests' | 'links'>): RequestRow[] {
  return REQUEST_KINDS.map((kind) => {
    const r = d.requests[kind];
    const late = r.oldest_days_late == null ? null : lateBy(r.oldest_days_late);
    return {
      kind, label: REQUEST_LABEL[kind], pending: r.pending, overdue: r.overdue, dueSoon: r.due_soon,
      oldest: late?.short ?? null, oldestLong: late?.long ?? null,
      pendingHref: figureHref(d, `requests.${kind}.pending`), overdueHref: figureHref(d, `requests.${kind}.overdue`),
    };
  });
}

// ─── Reviews ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReviewRow { key: keyof Reviews; label: string; noun: string; count: number; tone: Tone; href: string | null }

/** The four states of a review date (the library's own words), worst first. */
export function reviewRows(d: Pick<Overview, 'reviews' | 'links'>): ReviewRow[] {
  const r = d.reviews;
  return [
    { key: 'overdue', label: REVIEW_BUCKET_LABEL.overdue, noun: 'documents with an overdue review', count: r.overdue, tone: 'danger', href: figureHref(d, 'reviews.overdue') },
    { key: 'due_soon', label: REVIEW_BUCKET_LABEL.due_soon, noun: 'documents with a review due in 30 days', count: r.due_soon, tone: 'warning', href: figureHref(d, 'reviews.due_soon') },
    { key: 'unscheduled', label: REVIEW_BUCKET_LABEL.unscheduled, noun: 'documents with no review date', count: r.unscheduled, tone: 'default', href: figureHref(d, 'reviews.unscheduled') },
    { key: 'up_to_date', label: REVIEW_BUCKET_LABEL.ok, noun: 'documents with a review up to date', count: r.up_to_date, tone: 'success', href: figureHref(d, 'reviews.up_to_date') },
  ];
}

// ─── Issues ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface IssueRow { key: keyof Omit<Issues, 'documents'>; label: string; noun: string; count: number; tone: Tone; href: string | null; info: string }

/** The issue types, the ones that mean someone is stuck first. The words of the first four are the chips the library shows when it opens them. */
export function issueRows(d: Pick<Overview, 'issues' | 'links'>): IssueRow[] {
  const i = d.issues;
  const row = (key: IssueRow['key'], label: string, noun: string, tone: Tone, info: string): IssueRow => ({ key, label, noun, count: i[key], tone, href: figureHref(d, `issues.${key}`), info });
  return [
    row('stuck', 'Stuck in a stage', 'documents stuck in a stage', 'danger', 'In review or approval with nobody asked, or with a request overdue for more days than the escalation period in Governance settings.'),
    row('on_hold', 'On hold', 'documents on hold', 'warning', 'Someone asked for changes, or proposed one, and the route waits for the author.'),
    row('late_approvals', 'Late approvals', 'documents with late approvals', 'danger', 'A review or an approval is past its due date.'),
    row('late_acknowledgements', 'Late acknowledgements', 'documents with late acknowledgements', 'warning', 'Someone has not acknowledged a published document by the due date.'),
    row('no_owner', 'No owner', 'documents without an owner', 'warning', 'Documents nobody owns.'),
    row('expired', 'Expired', 'expired documents', 'danger', 'Documents past their expiry date.'),
    row('exception_applied', 'Exception', 'documents under an exception', 'warning', 'Documents under a policy exception.'),
  ];
}

// ─── When the request fails ────────────────────────────────────────────────────────────────────────────────────────────────

export type Failure = 'no-access' | 'not-yours' | 'not-found' | 'unavailable';

export const statusOf = (e: unknown): number | null => (e as { response?: { status?: number } } | null)?.response?.status ?? null;

/** What a failed request means to the person: no right at all (403), a department that is not theirs to open (403 with one asked for), one that
 *  does not exist (404), or anything else: said as unavailable, with Retry, never as zeros. */
export function failureOf(status: number | null, dept: string): Failure {
  if (status === 403) return dept.trim() ? 'not-yours' : 'no-access';
  if (status === 404) return 'not-found';
  return 'unavailable';
}

/** React Query's retry: a refusal, a missing department or a request the server cannot read is final; a network failure, a server error or "try later" is tried up to three times. */
export function retryOverview(failures: number, e: unknown): boolean {
  const status = statusOf(e);
  return failures < 3 && (status === null || status >= 500 || status === 408 || status === 425 || status === 429);
}
