// The Documents Overview's rules, in one place and without React, so `node --test` checks them (_model.test.ts): the shape the server answers
// (GET /governance/document-overview, backend modules/governance/documents_overview.py), the library address every figure opens, the words and
// the bars, and what a failed request says. The components only draw what this decides.
//
// Every figure is a link to the library already filtered (`links` in the answer holds its parameters, in the library's own vocabulary:
// libraryModel.ts PARAM_KEYS); a figure the server gave no address is plain text. A number the library cannot reproduce exactly says so in its (i).
import { formatCount, formatDateTime } from '../../../../../lib/format.ts';
import { documentStatus } from '../../../../../lib/status.ts';
import { REVIEW_BUCKET_LABEL, STAGE_ORDER } from '../_workspace/libraryModel.ts';

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
export interface StageRow { key: string; name: string; kind: string; count: number }
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
  stages: StageRow[];
  requests: Record<RequestKind, RequestFigures>;
  waiting: WaitingRow[];
  reviews: Reviews;
  issues: Issues;
  links: Links;
}

// ─── Addresses ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const LIBRARY = '/governance/documents';
export const OVERVIEW = `${LIBRARY}/overview`;
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

/** The people a step waits for: the names the server sent, and how many more there are. */
export function namesText(row: Pick<WaitingRow, 'waiting_for' | 'waiting_count'>): string {
  const more = Math.max(0, row.waiting_count - row.waiting_for.length);
  return row.waiting_for.join(', ') + (more ? ` +${more}` : '');
}

/** "As of 4 Nov 2026, 14:05" (the server's time is naive UTC: the viewer's own clock). */
export const asOfText = (asOf: string): string => `As of ${formatDateTime(asOf)}`;

/** How wide a bar is, as a percent of the longest: nothing for none, and never so thin that a document does not show. */
export function barPercent(count: number, max: number): number {
  if (!(count > 0) || !(max > 0)) return 0;
  return Math.min(100, Math.max(3, Math.round((count / max) * 100)));
}

/** "3 overdue reviews. Open in the library": what a figure's link is called for a screen reader. */
export const figureName = (n: number, noun: string): string => `${formatCount(n)} ${noun}. Open in the library`;

// ─── The six tiles ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Tone = 'default' | 'success' | 'warning' | 'danger';

export interface Tile {
  id: string;
  label: string;
  /** what the figure counts, for the name of its link: "overdue reviews" */
  noun: string;
  value: number;
  /** the library on this figure; or, for the two that add up several things, a place on this page */
  href: string | null;
  tone: Tone;
  /** what the figure counts, from its (i) */
  info: string;
}

/** Requests past their due date, all kinds: people asked, not documents. */
export const lateRequests = (d: Pick<Overview, 'requests'>): number => (['review', 'approval', 'acknowledgement'] as const).reduce((n, k) => n + d.requests[k].overdue, 0);

/** What a tile's link is called for a screen reader: the library for a figure that opens it, "the list below" for one that jumps to a section. */
export const tileLinkName = (t: Pick<Tile, 'value' | 'noun' | 'href'>): string =>
  t.href?.startsWith('#') ? `${formatCount(t.value)} ${t.noun}. Go to the list below` : figureName(t.value, t.noun);

export function tiles(d: Overview): Tile[] {
  const late = lateRequests(d);
  return [
    { id: 'documents', label: 'Documents', noun: 'documents', value: d.totals.documents, href: figureHref(d, 'totals.documents'), tone: 'default', info: 'Every document that is not archived.' },
    { id: 'in_force', label: 'In force', noun: 'documents in force', value: d.totals.in_force, href: figureHref(d, 'totals.in_force'), tone: 'success', info: 'Published documents.' },
    { id: 'in_progress', label: 'In progress', noun: 'documents in progress', value: d.totals.in_progress, href: figureHref(d, 'totals.in_progress'), tone: 'default',
      info: 'Drafts, and documents in review, in approval or approved.' },
    { id: 'overdue_reviews', label: 'Overdue reviews', noun: 'overdue reviews', value: d.reviews.overdue, href: figureHref(d, 'reviews.overdue'), tone: d.reviews.overdue ? 'danger' : 'default',
      info: 'Documents in force or approved whose review date has passed.' },
    { id: 'late_requests', label: 'Late requests', noun: 'late requests', value: late, href: '#waiting', tone: late ? 'danger' : 'default',
      info: 'Reviews, approvals and acknowledgements past their due date, one for each person asked. Opens the list below.' },
    { id: 'issues', label: 'Issues', noun: 'documents with issues', value: d.issues.documents, href: '#issues', tone: d.issues.documents ? 'warning' : 'default',
      info: 'Documents with at least one of the issues below, each counted once. Opens the list below.' },
  ];
}

/** Nothing to show: no document in this scope, not even an archived one. */
export const isEmpty = (d: Pick<Overview, 'totals'>): boolean => d.totals.documents === 0 && d.totals.archived === 0;

// ─── By department ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DepartmentLine {
  row: DepartmentRow;
  /** the address value of the department's own overview ("12", "none") */
  value: string;
  /** the row is the department the page is about: its name is not a link */
  here: boolean;
  /** the department's own overview, or null on the row that is the page itself */
  open: string | null;
  /** where the Issues figure leads: the list on this page, or on the department's own page */
  issuesHref: string;
  /** the path, the level in the organisation's word and how many documents are filed in the department itself */
  title: string;
  documentsHref: string | null;
  inForceHref: string | null;
  inProgressHref: string | null;
  overdueHref: string | null;
}

/** The rows of the department table, each with the addresses of its figures (the library on that department and everything under it). */
export function departmentLines(d: Pick<Overview, 'by_department' | 'links' | 'scope'>): DepartmentLine[] {
  return d.by_department.map((row) => {
    const value = row.department_id === null ? 'none' : String(row.department_id);
    const here = row.department_id !== null && row.department_id === d.scope.department_id;
    const below = row.documents - row.own;
    const title = [row.path.length > 1 ? row.path.join(' › ') : '', row.level_label, below > 0 ? `${formatCount(row.own)} filed in it, ${formatCount(below)} below it` : ''].filter(Boolean).join(' · ');
    return {
      row, value, here,
      open: here ? null : overviewHref(value),
      issuesHref: here ? '#issues' : `${overviewHref(value)}#issues`,
      title: title || row.name,
      documentsHref: figureHref(d, row.key), inForceHref: figureHref(d, `${row.key}:in_force`),
      inProgressHref: figureHref(d, `${row.key}:in_progress`), overdueHref: figureHref(d, `${row.key}:overdue_reviews`),
    };
  });
}

/** The table is worth a card when there is more than one row to compare: a unit with nothing under it is the six figures above. */
export const hasDepartmentTable = (d: Pick<Overview, 'by_department'>): boolean => d.by_department.length > 1;

// ─── By type, by status, by stage ──────────────────────────────────────────────────────────────────────────────────────────

export interface Bar { key: string; label: string; count: number; inForce: number; percent: number; href: string | null; inForceHref: string | null }

/** The type bars: each as long as its count against the biggest type. */
export function typeBars(d: Pick<Overview, 'by_type' | 'links'>): Bar[] {
  const max = d.by_type.reduce((m, t) => Math.max(m, t.count), 0);
  return d.by_type.map((t) => ({
    key: t.key, label: t.label, count: t.count, inForce: t.in_force, percent: barPercent(t.count, max),
    href: figureHref(d, t.key), inForceHref: figureHref(d, t.in_force_key),
  }));
}

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

export interface Stage { key: string; name: string; kind: string; noun: string; count: number; href: string | null }

/** The stages documents in review or approval are at, as the server grouped them (its order: by kind, then name). */
export const stages = (d: Pick<Overview, 'stages' | 'links'>): Stage[] => d.stages.map((s) => ({ ...s, noun: `documents in ${s.name}`, href: figureHref(d, s.key) }));

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

/** The reviews as one bar, each state as wide as its share of the documents a review is owed on; none when none is owed. The bar is only a picture: the rows say the numbers. */
export function reviewShares(r: Reviews): { key: keyof Reviews; percent: number }[] {
  const total = r.overdue + r.due_soon + r.unscheduled + r.up_to_date;
  if (total <= 0) return [];
  return (['overdue', 'due_soon', 'unscheduled', 'up_to_date'] as const).filter((k) => r[k] > 0).map((k) => ({ key: k, percent: (r[k] / total) * 100 }));
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
    row('late_acknowledgements', 'Late acknowledgements', 'documents with late acknowledgements', 'warning', 'Someone has not acknowledged a document in force by the due date.'),
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
