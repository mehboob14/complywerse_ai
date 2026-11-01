// The rules of the Evidence workspace, apart from React so `node --test` can pin them (evidenceModel.test.ts): what a filter keeps, the stat cards, the
// expiry reading, the maturity bands, which AI-review word a file wears, how a board column is cut, what the Snapshot shows, the keys of a list.
// Every formula here is the one the workspace always used (lib.tsx, EvidenceWorkspace.tsx, SnapshotView.tsx, PipelineView.tsx); only the words are
// said more plainly. The components draw, this file decides.
import { formatCount } from '../../../../lib/format.ts';
import { pageRange, type PageRange } from '../../../../lib/pagerModel.ts';
import type { ReviewBrief } from '../_review.tsx';

// ── the data the workspace reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface EvidenceItem {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  version: number;
  uploaded_by: number | null;
  uploader_name: string | null;
  uploaded_at: string | null;
  status: string;
  ocr_status: string;
  ocr_processed_at: string | null;
  evidence_type: string | null;
  collection_date: string | null;
  validity_period_days: number | null;
  expiry_date: string | null;
  is_stale: boolean;
  source_system: string | null;
  content_summary: string | null;
  quality_score: number | null;
  /** where the AI review of the file stands */
  ai_review?: ReviewBrief | null;
  submitted_by: number | null;
  submitted_at: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_comments: string | null;
  approved_by: number | null;
  approved_at: string | null;
  control_mappings_count?: number;
  owner_id?: number | null;
  owner_name?: string | null;
  department?: string | null;
  committee_id?: number | null;
  committee_name?: string | null;
  risk_links_count?: number;
  asset_links_count?: number;
  incident_links_count?: number;
  policy_links_count?: number;
}

export interface EvidenceSummary {
  total_count: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  stale_count: number;
  expiring_soon_count: number;
  pending_review_count: number;
  by_month?: Array<{ month: string; uploaded: number; approved: number }>;
}

// ── words ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** An evidence type said as words ("audit_report" is "Audit Report"; none is "Other", as the summary groups it). */
export function typeLabel(t: string | null | undefined): string {
  if (!t) return 'Other';
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Who owns a file: the designated owner, else whoever uploaded it, else nobody (null: the page says "Unassigned"). */
export function ownerOf(e: Pick<EvidenceItem, 'owner_name' | 'uploader_name'>): string | null {
  return e.owner_name || e.uploader_name || null;
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;

// ── the filter ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The statuses the Status filter offers. `stale` is not a status the server writes: it is the file's `is_stale` flag (past its validity). */
export const STATUS_VALUES = ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'archived', 'stale'] as const;

export interface Filters {
  /** the search text */
  q: string;
  /** statuses chosen (empty: all); `stale` means the is_stale flag */
  status: readonly string[];
  /** evidence types chosen (empty: all) */
  types: readonly string[];
}

export const NO_FILTERS: Filters = { q: '', status: [], types: [] };
export const isFiltered = (f: Filters): boolean => f.q.trim() !== '' || f.status.length > 0 || f.types.length > 0;

/** A file passes the Status filter when it is in any chosen status; `stale` is the is_stale flag. Nothing chosen keeps everything. */
export function matchesStatus(e: Pick<EvidenceItem, 'status' | 'is_stale'>, chosen: readonly string[]): boolean {
  if (chosen.length === 0) return true;
  return chosen.some((s) => (s === 'stale' ? !!e.is_stale : e.status === s));
}

/** What the search looks at: the name, the owner, the uploader and the source system (the server's own search also reads the description and the file
 *  name, which this one never did). */
export const searchText = (e: EvidenceItem): string => `${e.name} ${e.owner_name ?? ''} ${e.uploader_name ?? ''} ${e.source_system ?? ''}`.toLowerCase();

/** The files that pass the search, the status choice and the type choice. A file with no type never passes a type choice (it is "Other" in words,
 *  but the filter has always compared the stored value). */
export function filterItems(items: readonly EvidenceItem[], f: Filters): EvidenceItem[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((e) => {
    if (!matchesStatus(e, f.status)) return false;
    if (f.types.length > 0 && !f.types.includes(e.evidence_type ?? '')) return false;
    if (q && !searchText(e).includes(q)) return false;
    return true;
  });
}

/** The Type filter's choices: the server's list of types when it answered, else the types found in the files. */
export function typeOptions(server: ReadonlyArray<{ value: string; label: string }> | undefined, items: readonly EvidenceItem[]): Array<{ value: string; label: string }> {
  if (server && server.length) return server.map((t) => ({ value: t.value, label: t.label }));
  const found = Array.from(new Set(items.map((i) => i.evidence_type).filter((t): t is string => !!t)));
  return found.map((t) => ({ value: t, label: typeLabel(t) }));
}

/** Where a selection falls after the list changes: the chosen file if it is still listed, else the first one, else none. */
export function effectiveSelected(items: readonly EvidenceItem[], selectedId: number | null): number | null {
  return selectedId != null && items.some((i) => i.id === selectedId) ? selectedId : (items[0]?.id ?? null);
}

// ── what is loaded and what is true ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** The list request is capped; the server says how many there are. When there are more than were loaded the page says so (null: it is all here). */
export function cutNotice(loaded: number, total: number | null | undefined): { title: string; text: string } | null {
  if (typeof total !== 'number' || total <= loaded) return null;
  return {
    title: `Showing the newest ${formatCount(loaded)} of ${formatCount(total)} evidence items`,
    text: 'Search, filters and the views below use these items. The figures in the cards are for all of them.',
  };
}

/** The four cards. They read the server's summary only: a failed summary is a failed card, never numbers worked out from a list that may be cut.
 *  Approved is a share of all items (null when there are none: nothing is not 0%). */
export interface Tiles { total: number; approved: number; approvedPct: number | null; pending: number; expiring: number }
export function tiles(summary: EvidenceSummary | null | undefined): Tiles | null {
  if (!summary) return null;
  const total = summary.total_count ?? 0;
  const approved = summary.by_status?.approved ?? 0;
  return {
    total,
    approved,
    approvedPct: total > 0 ? Math.round((approved / total) * 100) : null,
    pending: summary.pending_review_count ?? 0,
    expiring: summary.expiring_soon_count ?? 0,
  };
}

// ── expiry and maturity ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ExpiryWord = 'expired' | 'expiring' | 'valid' | 'none';
export interface ExpiryReading { word: ExpiryWord; days: number | null; text: string }

/** How near the end of its validity a file is: the day count and the 30-day line the workspace always used (a file with `days < 0` is expired, up to
 *  30 days left is expiring). `now` is a parameter so a test can fix the clock. */
export function expiryReading(expiry: string | null | undefined, now: number = Date.now()): ExpiryReading {
  if (!expiry) return { word: 'none', days: null, text: 'No expiry' };
  const days = Math.ceil((new Date(expiry).getTime() - now) / 86_400_000);
  if (Number.isNaN(days)) return { word: 'none', days: null, text: '—' };
  if (days < 0) return { word: 'expired', days, text: `Expired ${plural(-days, 'day')} ago` };
  if (days <= 30) return { word: 'expiring', days, text: days === 0 ? 'Expires today' : `${plural(days, 'day')} left` };
  return { word: 'valid', days, text: `${plural(days, 'day')} left` };
}

/** A score that may arrive as 0-1 or 0-100, as a whole 0-100 number (null when there is none). */
export function normPct(v: number | null | undefined): number | null {
  if (v == null) return null;
  return v <= 1 ? Math.round(v * 100) : Math.round(v);
}

export type MaturityWord = 'strong' | 'fair' | 'weak' | 'poor' | 'unrated';
/** The band of a score: 80 and over, 60, 40, below (the bands the bars were always coloured by). */
export function maturityOf(pct: number | null): MaturityWord {
  if (pct == null) return 'unrated';
  if (pct >= 80) return 'strong';
  if (pct >= 60) return 'fair';
  if (pct >= 40) return 'weak';
  return 'poor';
}

// ── the AI review ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const isActiveReview = (status?: string | null): boolean => status === 'queued' || status === 'running';

export type ReviewWord = 'queued' | 'reading' | 'rating' | 'matching' | 'rated' | 'failed' | 'stopped' | 'unavailable' | 'ocr_stalled' | 'none';

/** The one word that says where a file's AI review stands. A file with a score is rated whatever the run did after. Without one: a run in progress is
 *  told by its step; a run that failed, or was lost, says so; a file that cannot be rated says why it cannot; a file whose reading never finished is
 *  stalled; anything else was not rated yet. Never "rating" for a run that is no longer there. */
export function reviewWord(input: { score: number | null; review?: ReviewBrief | null; ocrStalled?: boolean }): ReviewWord {
  if (input.score != null) return 'rated';
  const r = input.review;
  if (r && isActiveReview(r.status)) {
    if (r.status === 'queued') return 'queued';
    return r.step === 'rating' || r.step === 'matching' ? r.step : 'reading';
  }
  if (r?.status === 'failed') return r.stopped ? 'stopped' : 'failed';
  if (r?.status === 'unavailable') return 'unavailable';
  if (input.ocrStalled) return 'ocr_stalled';
  return 'none';
}

/** Whether the list should be asked again in a few seconds: a file is waiting to be read or being read, or its review is running. A file whose reading
 *  began more than ten minutes ago is not waited for (the server calls it stalled after ten: it will not finish by waiting), so one lost run cannot keep
 *  the page polling for ever. `uploaded` is read as the naive UTC the server writes. */
export const STALL_MS = 10 * 60 * 1000;
export function listIsBusy(items: ReadonlyArray<Pick<EvidenceItem, 'ocr_status' | 'ai_review' | 'uploaded_at'>>, now: number = Date.now()): boolean {
  return items.some((r) => {
    if (isActiveReview(r.ai_review?.status)) return true;
    if (r.ocr_status !== 'pending' && r.ocr_status !== 'processing') return false;
    const t = r.uploaded_at ? Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(r.uploaded_at) ? r.uploaded_at : `${r.uploaded_at}Z`) : NaN;
    return Number.isNaN(t) || now - t <= STALL_MS;
  });
}

// ── frameworks a file answers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FrameworkTag { name: string; count: number; linked: boolean }

/** Merge the frameworks of the linked controls, the frameworks of the clause suggestions and the AI's free-text frameworks into one list of tags,
 *  Linked first, then Suggested, each name once (the same rule the item page's Assessment tab uses). */
export function deriveApplicableFrameworks(
  byFramework: Array<{ framework_name: string; controls?: unknown[] }> | undefined,
  clauseFrameworkNames: string[] | undefined,
  aiFrameworks: string[] | undefined,
): FrameworkTag[] {
  const linked = new Map<string, number>();
  for (const f of byFramework || []) {
    if (f.framework_name) linked.set(f.framework_name, f.controls?.length ?? 0);
  }
  const suggested = new Map<string, number>();
  for (const n of clauseFrameworkNames || []) if (n && !linked.has(n)) suggested.set(n, (suggested.get(n) || 0) + 1);
  for (const raw of aiFrameworks || []) {
    const n = (raw || '').split(':')[0].trim();
    if (n && !linked.has(n) && !suggested.has(n)) suggested.set(n, 1);
  }
  const out: FrameworkTag[] = [];
  Array.from(linked.entries()).forEach(([name, count]) => out.push({ name, count: count || 1, linked: true }));
  Array.from(suggested.entries()).forEach(([name, count]) => out.push({ name, count, linked: false }));
  return out;
}

// ── the board ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The columns of the Pipeline, in the order a file moves through them. */
export const PIPELINE_STATUSES = ['draft', 'pending_review', 'approved', 'expired', 'rejected'] as const;

export interface BoardColumn { status: (typeof PIPELINE_STATUSES)[number]; count: number; shown: EvidenceItem[]; hidden: number }

/** Each column's true count and its first `cap` cards (the rest are counted, not drawn: a board of 1,000 cards is not a board). */
export function boardColumns(items: readonly EvidenceItem[], cap: number): BoardColumn[] {
  return PIPELINE_STATUSES.map((status) => {
    const all = items.filter((it) => it.status === status);
    return { status, count: all.length, shown: all.slice(0, Math.max(0, cap)), hidden: Math.max(0, all.length - Math.max(0, cap)) };
  });
}

/** Files that sit in no column (archived, or any status the board does not draw): said under the board, so the columns add up. */
export const offBoard = (items: readonly EvidenceItem[]): number => items.filter((it) => !(PIPELINE_STATUSES as readonly string[]).includes(it.status)).length;

export type Advance = { action: 'submit' | 'approve'; label: string; done: string };

/** The one step a card can take: a draft is submitted (anyone may), a pending file is approved (only a person who may review). The step is a button on
 *  the card: there is no drag and drop, so this IS the keyboard way to move a file. */
export function advanceStep(status: string, canReview: boolean): Advance | null {
  if (status === 'draft') return { action: 'submit', label: 'Submit for review', done: 'Submitted for review' };
  if (status === 'pending_review' && canReview) return { action: 'approve', label: 'Approve', done: 'Approved' };
  return null;
}

// ── the Snapshot ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The parts of the status split, in the order they are told, with the server's count of each (archived and any other status are counted too, so the
 *  parts add up to the total). */
export const SPLIT_ORDER = ['approved', 'pending_review', 'draft', 'rejected', 'expired', 'archived'] as const;
export function statusSplit(summary: EvidenceSummary | null | undefined): Array<{ key: string; count: number }> {
  const by = summary?.by_status ?? {};
  const parts = SPLIT_ORDER.map((key) => ({ key: key as string, count: key === 'pending_review' ? (by.pending_review ?? summary?.pending_review_count ?? 0) : (by[key] ?? 0) }));
  const other = Object.keys(by).filter((k) => !(SPLIT_ORDER as readonly string[]).includes(k)).reduce((s, k) => s + by[k], 0);
  return other > 0 ? parts.concat({ key: 'other', count: other }) : parts;
}

/** Approved as a share of all items (null when there are none). */
export const approvalRate = (summary: EvidenceSummary | null | undefined): number | null =>
  summary && summary.total_count > 0 ? Math.round(((summary.by_status?.approved ?? 0) / summary.total_count) * 100) : null;

/** The six-month trend and what is read from it: the approvals over all six months (the old card called this "this quarter"), and the latest month's
 *  approvals minus the earliest month's (the "+N" beside the rate). null when the server sent no trend. */
export function trendReading(summary: EvidenceSummary | null | undefined): { months: NonNullable<EvidenceSummary['by_month']>; approvedInWindow: number; delta: number | null } | null {
  const months = summary?.by_month;
  if (!months || months.length === 0) return null;
  return {
    months,
    approvedInWindow: months.reduce((s, m) => s + (m.approved ?? 0), 0),
    delta: months.length >= 2 ? months[months.length - 1].approved - months[0].approved : null,
  };
}

/** The five most common types and each one's bar width (a share of the largest). */
export function topTypes(summary: EvidenceSummary | null | undefined, n = 5): Array<{ type: string; count: number; pctOfMax: number }> {
  const rows = Object.entries(summary?.by_type ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n);
  const max = rows.length ? Math.max(...rows.map(([, c]) => c)) : 0;
  return rows.map(([type, count]) => ({ type, count, pctOfMax: max > 0 ? Math.round((count / max) * 100) : 0 }));
}

/** "Jun" for "2026-06" (the month's short English name, the same for every viewer); the text itself when it is not a month. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return y && m && m >= 1 && m <= 12 ? MONTHS[m - 1] : ym;
}

// ── the owner leaderboard (the Performance view) ──────────────────────────────────────────────────────────────────────────────────────────
export interface OwnerPerf { owner_id: number | null; owner_name: string | null; total: number; pending: number; approved: number; expired: number }
const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 100) : 0);
export const approvedShare = (o: Pick<OwnerPerf, 'approved' | 'total'>): number => pct(o.approved, o.total);

/** The leaderboard: owners ranked by approval rate (ties by volume), the top one, the one with the largest pending backlog, and the team's average rate. null when
 *  there are no owners. The same formulas the view always used. */
export function ownerBoard(owners: readonly OwnerPerf[]): { rows: Array<OwnerPerf & { rank: number }>; top: OwnerPerf; needsSupport: OwnerPerf; teamAvg: number } | null {
  if (!owners.length) return null;
  const ranked = owners.slice().sort((a, b) => {
    const ra = pct(a.approved, a.total);
    const rb = pct(b.approved, b.total);
    return rb !== ra ? rb - ra : b.total - a.total;
  });
  const needsSupport = owners.slice().sort((a, b) => b.pending - a.pending)[0];
  const totalItems = owners.reduce((s, o) => s + o.total, 0);
  const totalApproved = owners.reduce((s, o) => s + o.approved, 0);
  return { rows: ranked.map((o, i) => ({ ...o, rank: i + 1 })), top: ranked[0], needsSupport, teamAvg: pct(totalApproved, totalItems) };
}

// ── the register's export ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One CSV cell: quoted when it holds a comma, a quote or a line break (a quote is doubled); a value that starts like a spreadsheet formula (= + - @) gets a leading
 *  apostrophe so Excel reads it as text, not as a formula someone typed into a file name. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The register as CSV: a header row and a row per file, in the order given (what the person sees, filters and sort applied). */
export function registerCsv(items: readonly EvidenceItem[]): string {
  const head = ['Name', 'Type', 'Status', 'Stale', 'Owner', 'Controls linked', 'Maturity %', 'Expiry', 'Uploaded'];
  const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
  const rows = items.map((e) => [
    e.name, typeLabel(e.evidence_type), e.status, e.is_stale ? 'Yes' : 'No', ownerOf(e) ?? '', e.control_mappings_count ?? 0, normPct(e.quality_score) ?? '', day(e.expiry_date), day(e.uploaded_at),
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ── a page of a list ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PageOf<T> { range: PageRange; rows: T[] }
export function pageOfRows<T>(rows: readonly T[], page: number, pageSize: number): PageOf<T> {
  const range = pageRange(page, pageSize, rows.length);
  return { range, rows: range.to === 0 ? [] : rows.slice(range.from - 1, range.to) };
}
/** The page a given file is on, so a link to a file opens the list where it is (1 when it is not listed). */
export function pageOfId(items: ReadonlyArray<{ id: number }>, id: number, pageSize: number): number {
  const at = items.findIndex((i) => i.id === id);
  return at < 0 ? 1 : Math.floor(at / Math.max(1, pageSize)) + 1;
}

// ── the keys of a list ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Where a key moves focus in a list of `count` options when it is on option `at` (-1: none yet): ArrowDown / ArrowUp by one, PageDown / PageUp by ten,
 *  Home and End to the ends. The list stops at its ends. null for any other key; -1 when there is nothing to move to. */
export function optionAfter(count: number, at: number, key: string): number | null {
  const moves = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'];
  if (count <= 0) return moves.includes(key) ? -1 : null;
  const last = count - 1;
  const clamp = (n: number) => Math.max(0, Math.min(last, n));
  switch (key) {
    case 'ArrowDown': return clamp(at + 1);
    case 'ArrowUp': return at < 0 ? last : clamp(at - 1);
    case 'PageDown': return clamp(at + 10);
    case 'PageUp': return at < 0 ? last : clamp(at - 10);
    case 'Home': return 0;
    case 'End': return last;
    default: return null;
  }
}
