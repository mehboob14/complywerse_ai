// The rules of the Governance → Documents library, in one place and without React, so `node --test` checks them
// (libraryModel.test.ts): what each filter means, the numbers on the summary cards, the state of a review date, how a long list of
// frameworks is cut for a table cell, how the page's state lives in the address (a link opens the same view), how rows sort.
// The components only draw what this decides.
import { parseUtc } from '../../../../../lib/serverTime.ts';
import { NO_DEPARTMENT, matchesDepartment, shownFrameworkIds } from './library.ts';

// ─── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The approval workflow in order; expired / archived / exception are outside it. */
export const STAGE_ORDER = ['draft', 'pending_review', 'pending_approval', 'approved', 'published'] as const;

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'In Review',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  published: 'Published',
  expired: 'Expired',
  archived: 'Archived',
  exception_applied: 'Exception',
};
export const statusLabel = (status: string): string => STATUS_LABEL[status] || status.replace(/_/g, ' ');

export const DOC_TYPE_LABEL: Record<string, string> = {
  policy: 'Policy', standard: 'Standard', procedure: 'Procedure', guideline: 'Guideline', charter: 'Charter', framework: 'Framework',
};
export const typeLabel = (type: string | null | undefined): string =>
  (type && DOC_TYPE_LABEL[type]) || (type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ') : '—');

export const NO_OWNER = 'none';
export const NO_FRAMEWORK = 'none';
export { NO_DEPARTMENT };

// ─── The fields of a document these rules read (GovDoc satisfies it) ────────────────────────────────────────────────────

export interface LibDoc {
  id: number;
  title: string;
  document_code: string | null;
  description?: string | null;
  doc_type: string;
  status: string;
  classification?: string | null;
  owner_id: number | null;
  owner_name: string | null;
  author_id?: number | null;
  author_name?: string | null;
  department_id: number | null;
  framework_ids?: number[] | null;
  applicable_framework_ids?: number[] | null;
  tags?: string[] | null;
  next_review_date: string | null;
  version_in_force?: string | null;
  current_version?: string | null;
  created_at: string;
  updated_at: string;
  file_name?: string | null;
}

export interface FrameworkInfo { short: string; name: string }

/** What the rules need to know beyond the document itself. */
export interface Lookups {
  /** department id -> name */
  departments: Record<string, string>;
  /** framework id -> its short label and full name (the uploaded-frameworks list) */
  frameworks: Record<string, FrameworkInfo>;
  /** document id -> attestation % (documents with no campaign are absent) */
  coverage: Record<number, number>;
  /** the signed-in person */
  me: number | null;
}
export const NO_LOOKUPS: Lookups = { departments: {}, frameworks: {}, coverage: {}, me: null };

// ─── Review dates ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ReviewBucket = 'overdue' | 'due_soon' | 'ok' | 'unscheduled';
export const REVIEW_BUCKETS: ReviewBucket[] = ['overdue', 'due_soon', 'ok', 'unscheduled'];
export const REVIEW_BUCKET_LABEL: Record<ReviewBucket, string> = {
  overdue: 'Overdue', due_soon: 'Due in 30 days', ok: 'Up to date', unscheduled: 'No review date',
};
export const DUE_SOON_DAYS = 30;
const DAY = 86_400_000;
const utcDay = (d: Date) => Math.floor(d.getTime() / DAY);

/** Whether the document is one a review is owed on: in force (published, or a newer version is on its way over a published one) or
 *  approved and waiting to be published, as the Governance overview counts its overdue reviews. A draft, a withdrawn or an
 *  archived document owes none. */
export function reviewable(d: Pick<LibDoc, 'status' | 'version_in_force'>): boolean {
  if (d.status === 'archived' || d.status === 'expired') return false;
  return d.status === 'published' || d.status === 'approved' || !!d.version_in_force;
}

function span(n: number): string {
  if (n < 60) return `${n} ${n === 1 ? 'day' : 'days'}`;
  if (n < 365) return `${Math.round(n / 30.44)} months`;
  const years = Math.round((n / 365) * 2) / 2;
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

export interface ReviewState {
  /** where it counts (filters, the health card); null: no review is owed on it (not in force) */
  bucket: ReviewBucket | null;
  due: Date | null;
  /** whole UTC calendar days to the date; negative once it has passed; null without a date */
  days: number | null;
  /** the line under the date ("Overdue by 5 days", "Due in 12 days", "In 4 months", "Not scheduled"); '' when there is nothing to say */
  label: string;
}

export function reviewState(d: Pick<LibDoc, 'status' | 'version_in_force' | 'next_review_date'>, now: Date = new Date()): ReviewState {
  const due = parseUtc(d.next_review_date);
  const owed = reviewable(d);
  if (!due) return { bucket: owed ? 'unscheduled' : null, due: null, days: null, label: owed ? 'Not scheduled' : '' };
  const days = utcDay(due) - utcDay(now);
  if (!owed) return { bucket: null, due, days, label: '' };
  if (due.getTime() < now.getTime()) {                                  // the same test as the Governance overview's "overdue"
    const late = Math.max(0, -days);
    return { bucket: 'overdue', due, days, label: late === 0 ? 'Overdue today' : `Overdue by ${span(late)}` };
  }
  if (days <= DUE_SOON_DAYS) {
    return { bucket: 'due_soon', due, days, label: days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days` };
  }
  return { bucket: 'ok', due, days, label: `In ${span(days)}` };
}

export interface Health { reviewable: number; upToDate: number; dueSoon: number; overdue: number; unscheduled: number }

/** The "Document health" card: the documents a review is owed on, by where their review date stands. */
export function health(docs: readonly LibDoc[], now: Date = new Date()): Health {
  const h: Health = { reviewable: 0, upToDate: 0, dueSoon: 0, overdue: 0, unscheduled: 0 };
  for (const d of docs) {
    const b = reviewState(d, now).bucket;
    if (!b) continue;
    h.reviewable += 1;
    if (b === 'ok') h.upToDate += 1;
    else if (b === 'due_soon') h.dueSoon += 1;
    else if (b === 'overdue') h.overdue += 1;
    else h.unscheduled += 1;
  }
  return h;
}

// ─── The summary cards ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Kpis {
  /** every document that is not archived */
  all: number;
  draft: number;
  /** pending_review + pending_approval */
  inReview: number;
  /** approved, waiting to be published */
  approved: number;
  published: number;
  archived: number;
  /** created in the last 30 days (not archived) */
  addedLast30: number;
  health: Health;
}

export function kpis(docs: readonly LibDoc[], now: Date = new Date()): Kpis {
  const k: Kpis = { all: 0, draft: 0, inReview: 0, approved: 0, published: 0, archived: 0, addedLast30: 0, health: health(docs, now) };
  const since = now.getTime() - 30 * DAY;
  for (const d of docs) {
    if (d.status === 'archived') { k.archived += 1; continue; }
    k.all += 1;
    if (d.status === 'draft') k.draft += 1;
    else if (d.status === 'pending_review' || d.status === 'pending_approval') k.inReview += 1;
    else if (d.status === 'approved') k.approved += 1;
    else if (d.status === 'published') k.published += 1;
    const created = parseUtc(d.created_at);
    if (created && created.getTime() >= since) k.addedLast30 += 1;
  }
  return k;
}

/** What each status card selects when clicked (the Status filter's values). */
export const KPI_STATUSES = {
  all: [] as string[],
  draft: ['draft'],
  inReview: ['pending_review', 'pending_approval'],
  approved: ['approved'],
  published: ['published'],
  archived: ['archived'],
};

export const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

// ─── Attestation ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AttestationBucket = 'none' | 'not_started' | 'in_progress' | 'complete';
export const ATTESTATION_BUCKETS: AttestationBucket[] = ['complete', 'in_progress', 'not_started', 'none'];
export const ATTESTATION_LABEL: Record<AttestationBucket, string> = {
  complete: 'Everyone acknowledged', in_progress: 'In progress', not_started: 'Nobody yet', none: 'Not requested',
};
export function attestationBucket(pct: number | null | undefined): AttestationBucket {
  if (pct == null) return 'none';
  if (pct <= 0) return 'not_started';
  return pct >= 100 ? 'complete' : 'in_progress';
}

// ─── Frameworks in a table cell ──────────────────────────────────────────────────────────────────────────────────────────

export interface FrameworkChip { id: number; label: string; name: string; known: boolean }

export function frameworkChip(id: number, info: Record<string, FrameworkInfo>): FrameworkChip {
  const f = info[String(id)];
  const label = (f?.short || f?.name || '').trim();
  return label ? { id, label, name: (f?.name || label).trim(), known: true } : { id, label: `#${id}`, name: `Framework #${id}`, known: false };
}

export interface FrameworkDisplay {
  /** the chips the cell draws */
  chips: FrameworkChip[];
  /** the rest, behind "+N" */
  hidden: FrameworkChip[];
  total: number;
}

/**
 * How a document's frameworks are cut for a table cell, whatever their number: the first `max` as chips, the rest behind "+N" (the
 * count is the point: a cell never grows a row). The frameworks the person is filtering by come first, so a row shows why it
 * matched. Ids are de-duplicated; the order is the order they were linked in.
 */
export function frameworkDisplay(ids: readonly number[] | null | undefined, info: Record<string, FrameworkInfo>, opts: { max?: number; prefer?: readonly string[] } = {}): FrameworkDisplay {
  const max = Math.max(0, opts.max ?? 2);
  const seen = new Set<number>();
  const all = (ids ?? []).filter((id) => (seen.has(id) ? false : (seen.add(id), true))).map((id) => frameworkChip(id, info));
  const prefer = new Set(opts.prefer ?? []);
  const ordered = prefer.size ? [...all.filter((c) => prefer.has(String(c.id))), ...all.filter((c) => !prefer.has(String(c.id)))] : all;
  return { chips: ordered.slice(0, max), hidden: ordered.slice(max), total: ordered.length };
}

/** The list a popover or a tab shows: every framework by name, A to Z (a lookup list reads best sorted), narrowed by what was typed. */
export function frameworkList(ids: readonly number[] | null | undefined, info: Record<string, FrameworkInfo>, query = ''): FrameworkChip[] {
  const q = fold(query.trim());
  const seen = new Set<number>();
  return (ids ?? [])
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
    .map((id) => frameworkChip(id, info))
    .filter((c) => !q || fold(`${c.label} ${c.name}`).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/** Beyond this many frameworks a list gets a search box. */
export const FRAMEWORK_SEARCH_FROM = 8;

// ─── Filters ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Filters {
  search: string;
  types: string[];
  /** document statuses; 'archived' stands alone (the Archived list) */
  statuses: string[];
  /** owner ids as text, or NO_OWNER */
  owners: string[];
  /** department ids as text, or NO_DEPARTMENT */
  departments: string[];
  /** framework ids as text, or NO_FRAMEWORK */
  frameworks: string[];
  review: ReviewBucket[];
  attestation: AttestationBucket[];
  classifications: string[];
  /** owned or written by the signed-in person */
  mine: boolean;
}

export const NO_FILTERS: Filters = {
  search: '', types: [], statuses: [], owners: [], departments: [], frameworks: [], review: [], attestation: [], classifications: [], mine: false,
};

export type FacetKey = Exclude<keyof Filters, 'search' | 'mine'>;

/** How many things are being filtered on (the search counts one). */
export function filterCount(f: Filters): number {
  return (f.search.trim() ? 1 : 0) + (f.mine ? 1 : 0)
    + (['types', 'statuses', 'owners', 'departments', 'frameworks', 'review', 'attestation', 'classifications'] as FacetKey[])
      .reduce((n, k) => n + (f[k].length ? 1 : 0), 0);
}
export const isFiltering = (f: Filters) => filterCount(f) > 0;

/** The Status filter's next value: 'archived' cannot be mixed with the live statuses (the server refuses changing archived
 *  documents, and the Archived list offers Restore only): choosing it replaces the rest, choosing another status drops it. */
export function nextStatuses(prev: readonly string[], next: readonly string[]): string[] {
  if (next.includes('archived') && next.length > 1) return prev.includes('archived') ? next.filter((s) => s !== 'archived') : ['archived'];
  return [...next];
}
export const archivedOnly = (statuses: readonly string[]) => statuses.length === 1 && statuses[0] === 'archived';

const COMBINING = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

/** Lower-case without accents, so "zurich" finds "Zürich". */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(COMBINING, '').toLowerCase();
}

/** Everything the search box looks at for one document. */
export function haystack(d: LibDoc, lk: Lookups = NO_LOOKUPS): string {
  const fw = shownFrameworkIds(d).map((id) => { const c = frameworkChip(id, lk.frameworks); return `${c.label} ${c.name}`; });
  const dept = d.department_id != null ? lk.departments[String(d.department_id)] : '';
  return fold([
    d.title, d.document_code, d.description, d.owner_name, d.author_name, dept, ...fw, ...(d.tags ?? []),
    d.file_name, typeLabel(d.doc_type), statusLabel(d.status),
  ].filter(Boolean).join(' \n '));
}

export function searchTerms(q: string): string[] {
  return fold(q).split(/\s+/).filter(Boolean);
}

export interface MatchContext extends Lookups { now: Date }

/** Whether a document passes every filter: one facet keeps the documents that have ANY of the values chosen in it; the facets
 *  together all have to hold. */
export function matchesFilters(d: LibDoc, f: Filters, ctx: MatchContext): boolean {
  if (d.status === 'archived' && !f.statuses.includes('archived')) return false;
  if (f.statuses.length && !f.statuses.includes(d.status)) return false;
  if (f.types.length && !f.types.includes(d.doc_type)) return false;
  if (f.owners.length && !f.owners.some((o) => (o === NO_OWNER ? d.owner_id == null : String(d.owner_id ?? '') === o))) return false;
  if (f.departments.length && !f.departments.some((v) => matchesDepartment(d, v))) return false;
  if (f.frameworks.length) {
    const ids = shownFrameworkIds(d);
    if (!f.frameworks.some((v) => (v === NO_FRAMEWORK ? ids.length === 0 : ids.includes(Number(v))))) return false;
  }
  if (f.classifications.length && !f.classifications.includes((d.classification ?? '').toLowerCase())) return false;
  if (f.review.length) {
    const b = reviewState(d, ctx.now).bucket;
    if (!b || !f.review.includes(b)) return false;
  }
  if (f.attestation.length && !f.attestation.includes(attestationBucket(ctx.coverage[d.id]))) return false;
  if (f.mine && !(ctx.me != null && (d.owner_id === ctx.me || d.author_id === ctx.me))) return false;
  const terms = searchTerms(f.search);
  if (terms.length) {
    const hay = haystack(d, ctx);
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  return true;
}

// ─── Filter options (what the dropdowns offer) ───────────────────────────────────────────────────────────────────────────

export interface Option { value: string; label: string; subLabel?: string }

/** Frameworks that at least one document is mapped to, A to Z, after "No framework". */
export function frameworkOptions(docs: readonly LibDoc[], info: Record<string, FrameworkInfo>): Option[] {
  const used = new Set<number>();
  docs.forEach((d) => shownFrameworkIds(d).forEach((id) => used.add(id)));
  const rows = Array.from(used).map((id) => frameworkChip(id, info))
    .map((c) => ({ value: String(c.id), label: c.label, subLabel: c.name !== c.label ? c.name : undefined }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
  return [{ value: NO_FRAMEWORK, label: 'No framework' }, ...rows];
}

/** The classifications the documents carry (as the data spells them), sorted. */
export function classificationOptions(docs: readonly LibDoc[]): Option[] {
  const seen = new Set<string>();
  docs.forEach((d) => { const c = (d.classification ?? '').trim().toLowerCase(); if (c) seen.add(c); });
  return Array.from(seen).sort().map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ') }));
}

// ─── Sorting ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SortKey = 'title' | 'type' | 'lifecycle' | 'owner' | 'department' | 'frameworks' | 'attestation' | 'review' | 'version' | 'updated';
export type SortDir = 'asc' | 'desc';
export interface Sort { key: SortKey; dir: SortDir }
export const DEFAULT_SORT: Sort = { key: 'updated', dir: 'desc' };
export const SORT_KEYS: SortKey[] = ['title', 'type', 'lifecycle', 'owner', 'department', 'frameworks', 'attestation', 'review', 'version', 'updated'];

/** The direction a first click on a column sorts in: the one that answers the likely question (soonest review first, most
 *  frameworks first, newest first, A to Z). */
const FIRST_DIR: Record<SortKey, SortDir> = {
  title: 'asc', type: 'asc', lifecycle: 'asc', owner: 'asc', department: 'asc', frameworks: 'desc', attestation: 'asc',
  review: 'asc', version: 'desc', updated: 'desc',
};

/** Clicking a column header: its first direction, then the other, then back to the default order. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  if (current.dir === FIRST_DIR[key]) return { key, dir: FIRST_DIR[key] === 'asc' ? 'desc' : 'asc' };
  return DEFAULT_SORT;
}

const NO_VALUE = Symbol('empty');
type SortValue = string | number | typeof NO_VALUE;

/** "2.10" -> 2010, so 2.10 sorts after 2.9. */
export function versionNumber(v: string | null | undefined): number | null {
  const m = /(\d+)(?:\.(\d+))?/.exec(v ?? '');
  return m ? Number(m[1]) * 1000 + Number(m[2] ?? 0) : null;
}

export function sortValue(d: LibDoc, key: SortKey, lk: Lookups = NO_LOOKUPS): SortValue {
  switch (key) {
    case 'title': return fold(d.title);
    case 'type': return typeLabel(d.doc_type).toLowerCase();
    case 'lifecycle': {
      const i = (STAGE_ORDER as readonly string[]).indexOf(d.status);
      return i >= 0 ? i : d.status === 'expired' ? 5 : d.status === 'archived' ? 6 : 7;
    }
    case 'owner': return d.owner_name ? fold(d.owner_name) : NO_VALUE;
    case 'department': { const n = d.department_id != null ? lk.departments[String(d.department_id)] : ''; return n ? fold(n) : NO_VALUE; }
    case 'frameworks': return shownFrameworkIds(d).length;
    case 'attestation': { const p = lk.coverage[d.id]; return p == null ? NO_VALUE : p; }
    case 'review': { const due = parseUtc(d.next_review_date); return due ? due.getTime() : NO_VALUE; }
    case 'version': { const n = versionNumber(d.current_version); return n == null ? NO_VALUE : n; }
    case 'updated': { const t = parseUtc(d.updated_at); return t ? t.getTime() : NO_VALUE; }
  }
}

/** A comparer for the order chosen. A document with nothing in the column goes last in either direction; ties keep the newest first. */
export function compareDocs(sort: Sort, lk: Lookups = NO_LOOKUPS): (a: LibDoc, b: LibDoc) => number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const x = sortValue(a, sort.key, lk);
    const y = sortValue(b, sort.key, lk);
    if (x === NO_VALUE && y === NO_VALUE) return b.id - a.id;
    if (x === NO_VALUE) return 1;
    if (y === NO_VALUE) return -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c !== 0 ? sign * c : b.id - a.id;
  };
}

// ─── The page's state in the address ─────────────────────────────────────────────────────────────────────────────────────

export interface LibraryState { filters: Filters; sort: Sort }
export const DEFAULT_STATE: LibraryState = { filters: NO_FILTERS, sort: DEFAULT_SORT };

const LISTS: [FacetKey, string][] = [
  ['types', 'type'], ['statuses', 'status'], ['owners', 'owner'], ['departments', 'dept'], ['frameworks', 'fw'],
  ['review', 'review'], ['attestation', 'att'], ['classifications', 'cls'],
];

/** The search params that say this state (only what differs from the default, so the address of an unfiltered library is bare). */
export function toParams(state: LibraryState): URLSearchParams {
  const p = new URLSearchParams();
  const { filters: f, sort } = state;
  if (f.search.trim()) p.set('q', f.search.trim());
  for (const [key, name] of LISTS) if (f[key].length) p.set(name, f[key].join(','));
  if (f.mine) p.set('mine', '1');
  if (sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir) p.set('sort', `${sort.key}:${sort.dir}`);
  return p;
}

const list = (p: URLSearchParams, name: string): string[] =>
  (p.get(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean).filter((s, i, all) => all.indexOf(s) === i);

/** The state an address says. Anything it names that this page does not know is ignored, never an error. */
export function fromParams(p: URLSearchParams): LibraryState {
  const f: Filters = { ...NO_FILTERS, search: p.get('q') ?? '' };
  for (const [key, name] of LISTS) (f as unknown as Record<string, string[]>)[key] = list(p, name);
  f.review = f.review.filter((v): v is ReviewBucket => (REVIEW_BUCKETS as string[]).includes(v));
  f.attestation = f.attestation.filter((v): v is AttestationBucket => (ATTESTATION_BUCKETS as string[]).includes(v));
  f.statuses = nextStatuses([], f.statuses);
  f.mine = p.get('mine') === '1';
  const [key, dir] = (p.get('sort') ?? '').split(':');
  const sort: Sort = (SORT_KEYS as string[]).includes(key) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : DEFAULT_SORT;
  return { filters: f, sort };
}

/** The address keys that are the library's own (a link may carry others, e.g. the AI Studio's "+ Draft" link; they are left alone).
 *  `open` is the document peeked at in the drawer. */
export const PARAM_KEYS = ['q', 'type', 'status', 'owner', 'dept', 'fw', 'review', 'att', 'cls', 'mine', 'sort', 'open', 'id'];

/** The address with the library's keys replaced by this state (and the open document); every other key is kept as it was. */
export function withLibraryParams(current: URLSearchParams, state: LibraryState, openId: number | null): URLSearchParams {
  const out = new URLSearchParams();
  current.forEach((value, key) => { if (!PARAM_KEYS.includes(key)) out.append(key, value); });
  toParams(state).forEach((value, key) => out.set(key, value));
  if (openId != null) out.set('open', String(openId));
  return out;
}

/** The document the address says is open in the drawer (`id` is what the review calendar's link has always sent). */
export function openFromParams(p: URLSearchParams): number | null {
  const n = Number(p.get('open') ?? p.get('id'));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function sameState(a: LibraryState, b: LibraryState): boolean {
  return toParams(a).toString() === toParams(b).toString();
}

// ─── Views ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SavedView { id: string; name: string; state: LibraryState; builtIn?: boolean }

const view = (id: string, name: string, filters: Partial<Filters>): SavedView =>
  ({ id, name, builtIn: true, state: { filters: { ...NO_FILTERS, ...filters }, sort: DEFAULT_SORT } });

/** The views everyone has. */
export const BUILT_IN_VIEWS: SavedView[] = [
  view('all', 'All documents', {}),
  view('mine', 'My documents', { mine: true }),
  view('overdue', 'Review overdue', { review: ['overdue'] }),
  view('drafts', 'Drafts and in review', { statuses: ['draft', 'pending_review', 'pending_approval'] }),
  view('in-force', 'In force', { statuses: ['published'] }),
  view('no-owner', 'Without an owner', { owners: [NO_OWNER] }),
  view('no-framework', 'Without a framework', { frameworks: [NO_FRAMEWORK] }),
  view('archived', 'Archived', { statuses: ['archived'] }),
];

/** The view the state is exactly (built-in ones first, then the person's own). */
export function viewMatching(views: readonly SavedView[], state: LibraryState): SavedView | null {
  return views.find((v) => sameState(v.state, state)) ?? null;
}

// ─── A cell's words (also what the CSV says) ─────────────────────────────────────────────────────────────────────────────

const iso = (value: string | null | undefined, withTime = false): string => {
  const d = parseUtc(value);
  return d ? (withTime ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : d.toISOString().slice(0, 10)) : '';
};

export const EXPORT_COLUMNS = ['title', 'code', 'type', 'status', 'owner', 'department', 'frameworks', 'attestation', 'review', 'version', 'updated'] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export const EXPORT_HEADER: Record<ExportColumn, string> = {
  title: 'Title', code: 'Code', type: 'Type', status: 'Status', owner: 'Owner', department: 'Department', frameworks: 'Frameworks',
  attestation: 'Attestation %', review: 'Next review', version: 'Version', updated: 'Last updated',
};

export function exportValue(d: LibDoc, column: ExportColumn, lk: Lookups = NO_LOOKUPS): string {
  switch (column) {
    case 'title': return d.title;
    case 'code': return d.document_code ?? '';
    case 'type': return typeLabel(d.doc_type);
    case 'status': return statusLabel(d.status);
    case 'owner': return d.owner_name ?? '';
    case 'department': return d.department_id != null ? lk.departments[String(d.department_id)] ?? '' : '';
    case 'frameworks': return frameworkList(shownFrameworkIds(d), lk.frameworks).map((c) => c.name).join('; ');
    case 'attestation': return lk.coverage[d.id] != null ? String(Math.round(lk.coverage[d.id])) : '';
    case 'review': return iso(d.next_review_date);
    case 'version': return d.current_version ?? '';
    case 'updated': return iso(d.updated_at, true);
  }
}

/** The CSV columns that follow the table's: a column switched off is left out (the title, code and status always stay; the department
 *  goes with the owner, under which the table shows it). `hidden`: the optional columns switched off. */
export function exportColumnsFor(hidden: readonly string[]): ExportColumn[] {
  const off = (id: string) => hidden.includes(id);
  const out: ExportColumn[] = ['title', 'code'];
  if (!off('type')) out.push('type');
  out.push('status');
  if (!off('owner')) out.push('owner');
  if (!off('owner') || !off('department')) out.push('department');
  if (!off('frameworks')) out.push('frameworks');
  if (!off('attestation')) out.push('attestation');
  if (!off('review')) out.push('review');
  if (!off('version')) out.push('version');
  if (!off('updated')) out.push('updated');
  return out;
}

/** The CSV of the documents as the table shows them: one row each, the columns named, quoted where needed; the leading mark makes
 *  Excel read it as UTF-8 (Arabic and accented names survive). */
export function toCsv(docs: readonly LibDoc[], columns: readonly ExportColumn[], lk: Lookups = NO_LOOKUPS): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [columns.map((c) => cell(EXPORT_HEADER[c])).join(','), ...docs.map((d) => columns.map((c) => cell(exportValue(d, c, lk))).join(','))];
  return String.fromCharCode(0xfeff) + lines.join('\r\n');
}
