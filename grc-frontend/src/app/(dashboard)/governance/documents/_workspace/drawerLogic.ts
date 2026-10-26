// The rules of the library's detail drawer, in one place and without React, so `node --test` checks them (drawerLogic.test.ts): which
// facts the Overview lists and in what words (a fact nobody set says "—", never "Invalid Date"), the document's own dates as a
// timeline for organisations without the workflow feature, the tabs and the keys that move between them, and the one line the
// attestation block says. The component (DocumentDrawer.tsx) only draws what this decides.
import { parseUtc } from '../../../../../lib/serverTime.ts';
import { shownFrameworkIds } from './library.ts';
import { fileKind, fileSizeLabel, reviewCycleLabel, type FileKind } from './libraryFormat.ts';
import { STAGE_ORDER, type LibDoc, type Lookups } from './libraryModel.ts';

/** The fields of a document the drawer reads (GovDoc satisfies it). */
export interface DrawerDoc extends LibDoc {
  effective_date?: string | null;
  expiry_date?: string | null;
  last_reviewed_at?: string | null;
  review_cycle_months?: number | null;
  approved_at?: string | null;
  published_at?: string | null;
  has_file?: boolean;
  file_size?: number | null;
  file_type?: string | null;
}

export const DASH = '—';

// ─── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How a date is written ("12 Oct 2026"). The component passes atoms.shortDate (the same words), so the drawer and the table's review
 *  column cannot differ; this one is what the tests and any other caller get. */
export type DateText = (d: Date | null) => string;
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const utcDate: DateText = (d) => (d ? dateFmt.format(d) : '');

/** "1.2" -> "v1.2"; none -> "—" (the words of lib.tsx's verLabel, which draws React and so cannot be loaded by a plain test). */
export const versionText = (v: string | null | undefined): string => (!v ? DASH : v.startsWith('v') ? v : `v${v}`);

/** "v1.0 in force" while a newer version than the one in force is on its way; null otherwise (lib.tsx's inForceNote). */
export function inForceText(d: Pick<LibDoc, 'version_in_force' | 'current_version'>): string | null {
  return d.version_in_force && d.version_in_force !== d.current_version ? `${versionText(d.version_in_force)} in force` : null;
}

/** "confidential" -> "Confidential", "top_secret" -> "Top secret". */
const sentence = (s: string | null | undefined): string => {
  const t = (s ?? '').replace(/_/g, ' ').trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

// ─── Key information ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** How the component draws a row: a person (avatar and name), the review date (its own component, with how far off it is), a file
 *  (may be long), or plain text. */
export type InfoKind = 'person' | 'text' | 'review' | 'file';

export interface InfoRow {
  key: string;
  label: string;
  /** what is shown, with the row's own words when nobody set it ("—", "Unassigned", "Never", "Not set") */
  value: string;
  /** nothing was set: drawn quietly */
  empty: boolean;
  kind: InfoKind;
  /** a small line under the value ("v1.0 in force") */
  note?: string;
  /** takes both columns */
  wide?: boolean;
}

const KIND_WORD: Record<FileKind, string | null> = { pdf: 'PDF', word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint', text: 'Text', other: null };

/** "Access Control Policy.docx · Word · 48 KB": whatever of name, kind and size the document has. */
export function fileLine(doc: Pick<DrawerDoc, 'has_file' | 'file_name' | 'file_type' | 'file_size'>): string {
  const kind = fileKind(doc);
  const parts = [doc.file_name?.trim(), kind ? KIND_WORD[kind] : null, doc.file_size != null ? fileSizeLabel(doc.file_size) : null];
  return parts.filter(Boolean).join(' · ') || 'Attached file';
}

/**
 * The Overview's facts, in the order they are listed. A fact nobody set is not hidden (the person sees there is nothing); only
 * "Expires" (most documents never expire) and "File" (a document written on the platform has none) appear just when there is one.
 */
export function keyInfoRows(doc: DrawerDoc, lookups: Pick<Lookups, 'departments'>, formatDate: DateText = utcDate): InfoRow[] {
  const text = (key: string, label: string, value: string | null | undefined, none = DASH): InfoRow => {
    const v = (value ?? '').trim();
    return { key, label, kind: 'text', value: v || none, empty: !v };
  };
  const date = (key: string, label: string, raw: string | null | undefined, none = DASH, kind: InfoKind = 'text'): InfoRow => {
    const v = formatDate(parseUtc(raw));
    return { key, label, kind, value: v || none, empty: !v };
  };
  const department = doc.department_id != null ? lookups.departments[String(doc.department_id)] : '';
  const inForce = inForceText(doc);
  const cycle = doc.review_cycle_months ?? 0;

  const rows: InfoRow[] = [
    { ...text('owner', 'Owner', doc.owner_name, 'Unassigned'), kind: 'person' },
    text('department', 'Department', department),
    text('author', 'Prepared by', doc.author_name),
    text('classification', 'Classification', sentence(doc.classification)),
    { key: 'version', label: 'Version', kind: 'text', value: versionText(doc.current_version), empty: !doc.current_version, ...(inForce ? { note: inForce } : {}) },
    date('effective', 'Effective date', doc.effective_date),
    date('review', 'Next review', doc.next_review_date, DASH, 'review'),
    date('reviewed', 'Last reviewed', doc.last_reviewed_at, 'Never'),
    { key: 'cycle', label: 'Review cycle', kind: 'text', value: reviewCycleLabel(cycle), empty: cycle < 1 },
    date('approved', 'Approved', doc.approved_at),
    date('published', 'Published', doc.published_at),
  ];
  if (parseUtc(doc.expiry_date)) rows.push(date('expires', 'Expires', doc.expiry_date));
  if (doc.has_file) rows.push({ key: 'file', label: 'File', kind: 'file', value: fileLine(doc), empty: false, wide: true });
  return rows;
}

// ─── The document's own dates, as a timeline ─────────────────────────────────────────────────────────────────────────────

export interface DateEvent { key: 'created' | 'approved' | 'published' | 'effective'; label: string; at: Date; text: string }

/** What the Workflow tab shows when the organisation has no workflow history to read: the dates the document itself carries, the ones it
 *  has, oldest first (dates that fall on the same moment keep this order: created, approved, published, effective). */
export function timelineFromDates(
  doc: Pick<DrawerDoc, 'created_at' | 'approved_at' | 'published_at' | 'effective_date'>,
  formatDate: DateText = utcDate,
): DateEvent[] {
  const dates = [
    ['created', 'Created', doc.created_at],
    ['approved', 'Approved', doc.approved_at],
    ['published', 'Published', doc.published_at],
    ['effective', 'Effective', doc.effective_date],
  ] as const;
  return dates
    .flatMap(([key, label, raw]) => { const at = parseUtc(raw); return at ? [{ key, label, at, text: formatDate(at) }] : []; })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ─── Status ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether the status is a step of the approval workflow (drawn as its five dots); expired, archived and exception are outside it. */
export const inWorkflow = (status: string): boolean => (STAGE_ORDER as readonly string[]).includes(status);

// ─── Tabs ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TabId = 'overview' | 'workflow' | 'versions' | 'frameworks';
export interface DrawerTab { id: TabId; label: string }

/** The frameworks the document is mapped to, as the table's column shows them, each once. */
export const mappedFrameworkIds = (doc: Pick<DrawerDoc, 'framework_ids' | 'applicable_framework_ids'>): number[] =>
  Array.from(new Set(shownFrameworkIds(doc)));

export const mappedLine = (n: number): string => `Mapped to ${n} ${n === 1 ? 'framework' : 'frameworks'}`;

export function tabsFor(doc: Pick<DrawerDoc, 'framework_ids' | 'applicable_framework_ids'>): DrawerTab[] {
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'workflow', label: 'Workflow' },
    { id: 'versions', label: 'Versions' },
    { id: 'frameworks', label: `Frameworks (${mappedFrameworkIds(doc).length})` },
  ];
}

/** The tab an arrow key moves to (Left/Right wrap round, Home/End jump); null for any other key. */
export function nextTab<T extends string>(ids: readonly T[], current: T, key: string): T | null {
  const i = ids.indexOf(current);
  if (i < 0) return null;
  switch (key) {
    case 'ArrowRight': return ids[(i + 1) % ids.length];
    case 'ArrowLeft': return ids[(i - 1 + ids.length) % ids.length];
    case 'Home': return ids[0];
    case 'End': return ids[ids.length - 1];
    default: return null;
  }
}

// ─── Attestation ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AttestationSummary {
  /** an acknowledgement was asked for (the ring is drawn) */
  requested: boolean;
  pct: number | null;
  done: number | null;
  total: number | null;
  /** the one line */
  headline: string;
  /** a second, quieter line */
  detail: string | null;
}

/** What the attestation block says. `pct` is the coverage the library holds (absent: no campaign); `counts` the "4 of 5" where the
 *  server says it. */
export function attestationSummary(pct: number | null | undefined, counts?: { done: number; total: number } | null): AttestationSummary {
  const known = counts && counts.total > 0 ? counts : null;
  const percent = pct != null ? pct : known ? (100 * known.done) / known.total : null;
  if (percent == null) {
    return { requested: false, pct: null, done: null, total: null, headline: 'No acknowledgement has been requested', detail: null };
  }
  if (known) {
    const left = Math.max(0, known.total - known.done);
    return {
      requested: true, pct: percent, done: known.done, total: known.total,
      headline: `${known.done} of ${known.total} ${known.total === 1 ? 'person' : 'people'} acknowledged`,
      detail: left === 0 ? 'Everyone has acknowledged' : `${left} still to acknowledge`,
    };
  }
  return {
    requested: true, pct: percent, done: null, total: null,
    headline: `${Math.round(percent)}% acknowledged`,
    detail: percent >= 100 ? 'Everyone has acknowledged' : null,
  };
}
