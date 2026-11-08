// The rules of the Evidence Library, apart from React so `node --test` can pin them (libraryModel.test.ts): the words a file is told by (freshness, maturity, a reviewer's
// note), the quick views and what each counts, the order of the list, the columns of the board, what a bulk action may touch, and the sentence that says what it did.
// Formulas that already existed are the workspace's (evidenceModel.ts: the 30-day line, the 80 / 60 / 40 maturity bands, the percent rule); this file only adds how they are
// read together. Times are the server's naive UTC (parseUtc). A lapsed file is one past its validity, as the server worked it out when it sent the row.
import { formatCount } from '../../../../lib/format.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import { groupBoard, type BoardColumn } from '../../../../components/records/explorerModel.ts';
import { csvCell, expiryReading, maturityOf, normPct, ownerOf, typeLabel, type EvidenceItem, type MaturityWord } from '../_workspace/evidenceModel.ts';

export type LibraryRow = EvidenceItem;

/** The value of "no owner / no framework" in the facets that offer it. */
export const NONE = 'none';
/** The value of a file with no type: the summary has always grouped it under "other". */
export const OTHER_TYPE = 'other';

// ── freshness ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const FRESHNESS = ['in_date', 'expiring', 'lapsed', 'no_expiry'] as const;
export type Freshness = (typeof FRESHNESS)[number];

/** Past its validity: the server's word (`lapsed`, worked out when it sent the row), or an expiry date that has gone by since. Archived files are out of play and never lapse. */
export function isLapsed(row: Pick<EvidenceItem, 'status' | 'lapsed' | 'is_stale' | 'expiry_date'>, now: number = Date.now()): boolean {
  if (row.status === 'archived') return false;
  if (row.lapsed || row.status === 'expired') return true;
  const expiry = parseUtc(row.expiry_date)?.getTime();
  return expiry !== undefined && expiry < now;
}

/** Where a file stands against its date: lapsed, ending within 30 days (the line the workspace always used), in date, or no date at all (and an archived file has none that matters). */
export function freshnessOf(row: Pick<EvidenceItem, 'status' | 'lapsed' | 'is_stale' | 'expiry_date'>, now: number = Date.now()): Freshness {
  if (row.status === 'archived') return 'no_expiry';
  if (isLapsed(row, now)) return 'lapsed';
  const reading = expiryReading(row.expiry_date, now);
  if (reading.word === 'none') return 'no_expiry';
  return reading.word === 'expiring' ? 'expiring' : 'in_date';
}

/** The maturity band of a file: strong, fair, weak, poor, or not rated. */
export const maturityOfRow = (row: Pick<EvidenceItem, 'quality_score'>): MaturityWord => maturityOf(normPct(row.quality_score));

// ── people ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The facet value of a file's owner: the designated owner, else whoever uploaded it, else none. */
export function ownerKey(row: Pick<EvidenceItem, 'owner_id' | 'uploaded_by'>): string {
  const id = row.owner_id ?? row.uploaded_by;
  return id == null ? NONE : String(id);
}

/** Whether a file is a person's: they own it, or they uploaded it and nobody else owns it. */
export function isMine(row: Pick<EvidenceItem, 'owner_id' | 'uploaded_by'>, me: number | null): boolean {
  return me != null && ownerKey(row) === String(me);
}

/** The reviewer's note on a file that was sent back: a draft with a note whose last review was a return (an approval would have stamped the same moment on the approval).
 *  A file approved later, or renewed after an approval, carries no such note. null otherwise. */
export function returnedNote(row: Pick<EvidenceItem, 'status' | 'review_comments' | 'reviewed_at' | 'approved_at'>): string | null {
  const note = (row.review_comments ?? '').trim();
  if (row.status !== 'draft' || !note || !row.reviewed_at) return null;
  const reviewed = parseUtc(row.reviewed_at)?.getTime();
  const approved = parseUtc(row.approved_at)?.getTime();
  return approved === undefined || reviewed === undefined || approved < reviewed ? note : null;
}

// ── the quick views ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const QUICK_IDS = ['all', 'waiting', 'expiring', 'lapsed', 'unrated', 'unlinked', 'mine'] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const QUICK_LABEL: Record<QuickId, string> = {
  all: 'All', waiting: 'Waiting for me', expiring: 'Expiring in 30 days', lapsed: 'Lapsed', unrated: 'Not rated', unlinked: 'Not linked', mine: 'Mine',
};
/** What the person can do and who they are, which the quick views read. */
export interface Viewer { me: number | null; canReview: boolean; now: number }

/** Whether a file is in a quick view. Archived files are in none of them but "All" does not show them either (the Status facet brings them back). */
export function inQuick(id: QuickId, row: LibraryRow, v: Viewer): boolean {
  if (row.status === 'archived') return false;
  switch (id) {
    case 'all': return true;
    case 'waiting': return (v.canReview && row.status === 'pending_review') || (isMine(row, v.me) && returnedNote(row) !== null);
    case 'expiring': return freshnessOf(row, v.now) === 'expiring';
    case 'lapsed': return freshnessOf(row, v.now) === 'lapsed';
    case 'unrated': return normPct(row.quality_score) === null;
    case 'unlinked': return (row.links_count ?? row.control_mappings_count ?? 0) === 0;
    case 'mine': return isMine(row, v.me);
    default: return false;
  }
}

// ── the order of the list ────────────────────────────────────────────────────────────────────────────────────────────────
export const SORT_KEYS = ['uploaded', 'name', 'status', 'expiry', 'maturity', 'owner'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'uploaded', dir: 'desc' };
export const SORT_LABEL: Record<SortKey, string> = { uploaded: 'Newest', name: 'Name', status: 'Status', expiry: 'Expiry', maturity: 'Maturity', owner: 'Owner' };
/** The direction a column starts in when it is first pressed. */
export const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { uploaded: 'desc', name: 'asc', status: 'asc', expiry: 'asc', maturity: 'desc', owner: 'asc' };

/** The next order when a header is pressed: a new column starts in its first direction, the same column turns round, and a second turn goes back to the default. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  if (current.dir === FIRST_DIR[key]) return { key, dir: FIRST_DIR[key] === 'asc' ? 'desc' : 'asc' };
  return DEFAULT_SORT;
}

const STATUS_ORDER = ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'archived'];

/** The files in the order asked for. A file without the value (no expiry, not rated) goes last whichever way the column runs; ties fall back to the newest first. */
export function sortRows(rows: readonly LibraryRow[], sort: Sort): LibraryRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (r: LibraryRow): string | number | null => {
    switch (sort.key) {
      case 'name': return r.name.toLowerCase();
      case 'status': { const at = STATUS_ORDER.indexOf(r.status); return at < 0 ? STATUS_ORDER.length : at; }
      case 'expiry': return parseUtc(r.expiry_date)?.getTime() ?? null;
      case 'maturity': return normPct(r.quality_score);
      case 'owner': return (ownerOf(r) ?? '').toLowerCase() || null;
      default: return parseUtc(r.uploaded_at)?.getTime() ?? null;
    }
  };
  const newest = (a: LibraryRow, b: LibraryRow) => (parseUtc(b.uploaded_at)?.getTime() ?? 0) - (parseUtc(a.uploaded_at)?.getTime() ?? 0) || b.id - a.id;
  return rows.slice().sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return newest(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return newest(a, b);
    return (x < y ? -1 : 1) * sign;
  });
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the search looks at: the name, the file name, the type in words, the owner, the uploader, the source and the frameworks. */
export const haystack = (e: LibraryRow): string =>
  `${e.name} ${e.file_name ?? ''} ${typeLabel(e.evidence_type)} ${e.owner_name ?? ''} ${e.uploader_name ?? ''} ${e.source_system ?? ''} ${(e.frameworks ?? []).join(' ')}`.toLowerCase();

/** The words of a search: split on spaces, folded; every one has to be in the text. */
export const searchTerms = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

// ── the board ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Draft, pending review, approved and in date, and lapsed (formerly in force: approved or expired). A file sent back by hand to `rejected` has a column only while there is one.
 *  A lapsed draft or pending file stays in its own column, wearing the Lapsed pill: the lapse is about a file that WAS in force. Archived files are not on the board. */
export function boardOf(rows: readonly LibraryRow[], now: number): BoardColumn<LibraryRow>[] {
  const cols = groupBoard(rows, [
    { id: 'draft', label: 'Draft', test: (r) => r.status === 'draft' },
    { id: 'pending_review', label: 'Pending review', test: (r) => r.status === 'pending_review' },
    { id: 'approved', label: 'Approved', test: (r) => r.status === 'approved' && !isLapsed(r, now) },
    { id: 'lapsed', label: 'Lapsed', test: (r) => (r.status === 'approved' || r.status === 'expired') && isLapsed(r, now) },
    { id: 'rejected', label: 'Rejected', test: (r) => r.status === 'rejected' },
  ]);
  return cols.filter((c) => c.id !== 'rejected' || c.rows.length > 0);
}

// ── bulk actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type BulkKind = 'submit' | 'approve' | 'package' | 'delete';
export interface BulkRights { canReview: boolean; canDelete: boolean }

/** Which of the ticked files an action applies to: submit takes drafts, approve takes pending files (for a person who may review), a package takes approved files (what the package
 *  builder always offered), delete takes all (for a person who may delete). The rest are `skipped`, each counted under the reason it is skipped for. */
export function bulkPlan(kind: BulkKind, rows: readonly LibraryRow[], rights: BulkRights): { ids: number[]; skipped: number; why: string } {
  const [takes, why] = ((): [(r: LibraryRow) => boolean, string] => {
    switch (kind) {
      case 'submit': return [(r) => r.status === 'draft', 'not a draft'];
      case 'approve': return [(r) => rights.canReview && r.status === 'pending_review', rights.canReview ? 'not waiting for review' : 'you may not approve'];
      case 'package': return [(r) => r.status === 'approved', 'not approved'];
      default: return [() => rights.canDelete, 'you may not delete'];
    }
  })();
  const ids = rows.filter(takes).map((r) => r.id);
  return { ids, skipped: rows.length - ids.length, why };
}

const files = (n: number) => `${formatCount(n)} ${n === 1 ? 'file' : 'files'}`;

/** What did not go as asked, in words: "2 files failed. 1 was skipped (not a draft)." Empty when everything went. */
export function bulkDetails(result: { failed: number; skipped: number; why: string }): string {
  const parts: string[] = [];
  if (result.failed) parts.push(`${files(result.failed)} failed.`);
  if (result.skipped) parts.push(`${formatCount(result.skipped)} ${result.skipped === 1 ? 'was' : 'were'} skipped (${result.why}).`);
  return parts.join(' ');
}

/** What a bulk action did, in one sentence for the toast: "Submitted 4 files. 2 were skipped (not a draft)." */
export function bulkSentence(verb: string, result: { done: number; failed: number; skipped: number; why: string }): string {
  return [`${verb} ${files(result.done)}.`, bulkDetails(result)].filter(Boolean).join(' ');
}

// ── the export ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The files as CSV, in the order given (what the person sees, filters and sort applied): the same cells the old register exported, plus the state of the date. */
export function libraryCsv(rows: readonly LibraryRow[], now: number = Date.now()): string {
  const head = ['Name', 'Type', 'Status', 'Freshness', 'Owner', 'Frameworks', 'Controls linked', 'Maturity %', 'Expiry', 'Uploaded'];
  const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
  const out = rows.map((e) => [
    e.name, typeLabel(e.evidence_type), e.status, freshnessOf(e, now), ownerOf(e) ?? '', (e.frameworks ?? []).join('; '), e.control_mappings_count ?? 0, normPct(e.quality_score) ?? '', day(e.expiry_date), day(e.uploaded_at),
  ]);
  return [head, ...out].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** "evidence-library-2026-11-08-42-files.csv" */
export const exportName = (day: string, count: number, selectionOnly: boolean): string => `evidence-library-${day}-${selectionOnly ? 'selected-' : ''}${count}-${count === 1 ? 'file' : 'files'}.csv`;
