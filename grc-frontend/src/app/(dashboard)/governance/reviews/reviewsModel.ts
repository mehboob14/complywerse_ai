// Governance > Reviews as pure functions (reviewsModel.test.ts): what the address says, the rows the list shows and how they are searched, put in
// order and counted, and the words of a row. No React. The calendar's own rules (days, months, due state) are calendarModel.ts.
//
// THE ADDRESS. /governance/reviews?section=actions|documents &view=list|calendar &tab=overdue|upcoming|all &month=2026-11 &day=2026-11-12, every
// param optional, the default state the plain address. /governance/reviews/calendar is a door to the same page already on its calendar view (bookmarks
// and old links keep working): it stays on that path while the calendar is showing, and leaves it for /governance/reviews when the list is chosen.
import { statusLabel } from '../../../../lib/format.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import { sortRows, type SortState, type SortValue } from '../../../../components/ui/ds/tableModel.ts';
import { DUE_SOON_DAYS, dayOf, monthKey, parseDay, parseMonth, type DayKey, type DueState, type Month } from './calendarModel.ts';

export const REVIEWS_PATH = '/governance/reviews';
export const CALENDAR_PATH = '/governance/reviews/calendar';

export type Section = 'documents' | 'actions';
export type View = 'list' | 'calendar';
export type ListTab = 'overdue' | 'upcoming' | 'all';

export const SECTIONS: readonly Section[] = ['documents', 'actions'];
export const VIEWS: readonly View[] = ['list', 'calendar'];
export const LIST_TABS: readonly ListTab[] = ['overdue', 'upcoming', 'all'];

export interface ReviewsLocation {
  section: Section;
  view: View;
  tab: ListTab;
  /** the month the calendar shows; null: the viewer's current month */
  month: Month | null;
  /** the day chosen on the calendar */
  day: DayKey | null;
}

const pick = <T extends string>(options: readonly T[], value: string | null, fallback: T): T => {
  const hit = options.find((o) => o === (value ?? '').trim().toLowerCase());
  return hit ?? fallback;
};
const cleanPath = (pathname: string | null | undefined): string => (pathname ?? '').split(/[?#]/)[0].replace(/\/+$/, '');

/** The state an address stands for. A param that is not one of the options is the default; the calendar's door path opens the calendar view unless
 *  `view=list` says otherwise. */
export function parseLocation(pathname: string | null | undefined, search: string | null | undefined): ReviewsLocation {
  const q = new URLSearchParams(search ?? '');
  const atDoor = cleanPath(pathname) === CALENDAR_PATH;
  return {
    section: pick(SECTIONS, q.get('section'), 'documents'),
    view: pick(VIEWS, q.get('view'), atDoor ? 'calendar' : 'list'),
    tab: pick(LIST_TABS, q.get('tab'), 'overdue'),
    month: parseMonth(q.get('month')),
    day: parseDay(q.get('day')) ? (q.get('day') as DayKey) : null,
  };
}

/** The address of a state: the plain one for the default state. `door` is the path the person is on: the calendar's door is kept while the calendar shows. */
export function reviewsHref(loc: ReviewsLocation, door?: string | null): string {
  const calendar = loc.section === 'documents' && loc.view === 'calendar';
  const onDoor = calendar && cleanPath(door) === CALENDAR_PATH;
  const q = new URLSearchParams();
  if (loc.section !== 'documents') q.set('section', loc.section);
  if (loc.section === 'documents') {
    if (calendar && !onDoor) q.set('view', 'calendar');
    if (loc.tab !== 'overdue') q.set('tab', loc.tab);                // kept while the calendar shows, so the list is as it was left when the person comes back to it
    if (calendar && loc.month) q.set('month', monthKey(loc.month));
    if (calendar && loc.day) q.set('day', loc.day);
  }
  const text = q.toString();
  return `${onDoor ? CALENDAR_PATH : REVIEWS_PATH}${text ? `?${text}` : ''}`;
}

// ── the rows ─────────────────────────────────────────────────────────────────
/** One document with a review date, as GET /governance/reviews/{overdue,upcoming} sends it (the fields the page reads). */
export interface ReviewDoc {
  id: number;
  document_code: string | null;
  title: string;
  doc_type: string;
  owner_name: string | null;
  review_cycle_months: number | null;
  next_review_date: string | null;
  last_reviewed_at: string | null;
  days_until_review: number | null;
  is_overdue: boolean;
}

/** What the list asks for each time: the server's default is 100, which cut a backlog of 200 to 100 while the tab said 200. */
export const REVIEW_FETCH_LIMIT = 1000;

export const DOCUMENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'policy', label: 'Policy' }, { value: 'standard', label: 'Standard' }, { value: 'procedure', label: 'Procedure' },
  { value: 'guideline', label: 'Guideline' }, { value: 'charter', label: 'Charter' }, { value: 'framework', label: 'Framework' },
];

export function typeLabel(type: string | null | undefined): string {
  const hit = DOCUMENT_TYPES.find((t) => t.value === type);
  return hit ? hit.label : statusLabel(type);
}

/** The list's own state of a row, from the server's flags (the rule of the lists and of the statistics): `is_overdue`; else `days_until_review` of 7 or
 *  fewer is due soon (the old list's amber); else on track. null when the row has no review date. */
export function rowState(doc: Pick<ReviewDoc, 'next_review_date' | 'is_overdue' | 'days_until_review'>): DueState | null {
  if (!dayOf(doc.next_review_date)) return null;
  if (doc.is_overdue) return 'overdue';
  return doc.days_until_review !== null && doc.days_until_review <= DUE_SOON_DAYS ? 'due_soon' : 'on_track';
}

/** The rows of the Overdue tab and of the Upcoming tab as one list, a document once, the earliest review date first (no date last). */
export function mergeAll(overdue: readonly ReviewDoc[], upcoming: readonly ReviewDoc[]): ReviewDoc[] {
  const byId = new Map<number, ReviewDoc>();
  overdue.concat(upcoming).forEach((doc) => byId.set(doc.id, doc));
  const at = (doc: ReviewDoc): number => parseUtc(doc.next_review_date)?.getTime() ?? Number.POSITIVE_INFINITY;
  return Array.from(byId.values()).sort((a, b) => (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1));
}

/** The rows that contain every word of `query` (any case) in their title, code, owner or type. An empty query leaves the list as it is. */
export function searchReviews<T extends Pick<ReviewDoc, 'title' | 'document_code' | 'owner_name' | 'doc_type'>>(rows: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows.slice();
  return rows.filter((r) => {
    const text = `${r.title} ${r.document_code ?? ''} ${r.owner_name ?? ''} ${typeLabel(r.doc_type)}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export function sortValue(doc: ReviewDoc, key: string): SortValue {
  switch (key) {
    case 'title': return doc.title;
    case 'owner': return doc.owner_name;
    case 'next': return dayOf(doc.next_review_date);            // "2026-11-12" sorts as the day it is
    case 'last': return parseUtc(doc.last_reviewed_at);
    case 'cycle': return doc.review_cycle_months;
    default: return null;
  }
}

export const sortReviews = (rows: readonly ReviewDoc[], sort: SortState): ReviewDoc[] => sortRows(rows, sort, sortValue);

/** One page of the rows, 1-based, the page clamped into range. */
export function pageOf<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  return rows.slice((at - 1) * size, at * size);
}

/** What the list holds against what the server has: the first `loaded` rows of `total`. A cut list says so (the person must not read a search or a page
 *  count as covering everything). */
export function coverage(loaded: number, total: number | null | undefined): { loaded: number; total: number; cut: boolean } {
  const all = typeof total === 'number' && Number.isFinite(total) ? Math.max(total, loaded) : loaded;
  return { loaded, total: all, cut: all > loaded };
}

// ── the actions log (the second section) ─────────────────────────────────────
export const ACTION_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All actions' }, { value: 'pending_review', label: 'Pending review' }, { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
];

const ACTION_TYPES: Record<string, string> = {
  document_draft_created: 'Document draft', document_uploaded: 'Document upload', policy_statement_created: 'Policy statement', risk_acceptance: 'Risk acceptance',
  evidence_uploaded: 'Evidence upload', committee_action: 'Committee action', attestation_created: 'Attestation', certification_submitted: 'Certification',
};

export function actionTypeLabel(type: string | null | undefined): string {
  return (type && Object.prototype.hasOwnProperty.call(ACTION_TYPES, type) ? ACTION_TYPES[type] : statusLabel(type));
}
