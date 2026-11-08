// The figures of the Evidence Insights tab, apart from React so `node --test` can pin them (insightsModel.test.ts). The tiles are the server's summary (true totals); the lists and
// the owner table are worked out from the Library's rows (the same files, the same rules: libraryModel.ts), so the Library and Insights never disagree about what is lapsed.
// "Approved" is the status column, as it always was; "In force" is approved AND still in date: both are shown, side by side.
import { formatCount } from '../../../../lib/format.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import { normPct, ownerOf, type EvidenceItem, type EvidenceSummary } from '../_workspace/evidenceModel.ts';
import { freshnessOf, isLapsed, ownerKey, type LibraryRow } from '../_library/libraryModel.ts';

// ── the tiles ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface InsightTiles {
  total: number;
  /** of the total, the files kept out of the Library until Archived is chosen */
  archived: number;
  approved: number;
  /** approved as a share of all files (null when there are none: nothing is not 0%) */
  approvedPct: number | null;
  inForce: number;
  inForcePct: number | null;
  pending: number;
  expiring: number;
  lapsed: number;
}

const share = (n: number, of: number): number | null => (of > 0 ? Math.round((n / of) * 100) : null);

export function insightTiles(summary: EvidenceSummary | null | undefined): InsightTiles | null {
  if (!summary) return null;
  const total = summary.total_count ?? 0;
  const approved = summary.by_status?.approved ?? 0;
  // an older server sent neither figure: the tile then says it was not recorded rather than guess from a list that may be cut
  const inForce = summary.in_force_count ?? 0;
  return {
    total, archived: summary.by_status?.archived ?? 0, approved, approvedPct: share(approved, total), inForce, inForcePct: summary.in_force_count == null ? null : share(inForce, total),
    pending: summary.pending_review_count ?? 0, expiring: summary.expiring_soon_count ?? 0, lapsed: summary.lapsed_count ?? summary.stale_count ?? 0,
  };
}

// ── what needs a look ────────────────────────────────────────────────────────────────────────────────────────────────────
export const WATCH_SHOWN = 6;
/** Rated below this is low maturity (the coverage page's old line, 50). */
export const LOW_MATURITY = 50;

export interface Attention { lapsed: LibraryRow[]; expiring: LibraryRow[]; low: LibraryRow[] }

const expiryOf = (r: EvidenceItem): number => parseUtc(r.expiry_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;

/** The files to look at, worst first: lapsed (the longest lapsed first; a file marked lapsed by hand with no date last), ending within 30 days (soonest first), and rated below 50%
 *  (lowest first). Archived files are in none. The scale of the stored score is read the way the Library reads it (0-1 or 0-100). */
export function attention(rows: readonly LibraryRow[], now: number): Attention {
  const live = rows.filter((r) => r.status !== 'archived');
  return {
    lapsed: live.filter((r) => isLapsed(r, now)).sort((a, b) => expiryOf(a) - expiryOf(b) || b.id - a.id),
    expiring: live.filter((r) => freshnessOf(r, now) === 'expiring').sort((a, b) => expiryOf(a) - expiryOf(b) || b.id - a.id),
    low: live.filter((r) => { const pct = normPct(r.quality_score); return pct !== null && pct < LOW_MATURITY; }).sort((a, b) => (normPct(a.quality_score) ?? 0) - (normPct(b.quality_score) ?? 0) || b.id - a.id),
  };
}

// ── by owner ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface OwnerRow { key: string; name: string | null; total: number; approved: number; inForce: number; pending: number; lapsed: number }

/** Files per owner (the designated owner, else whoever uploaded it), the most files first; ties by name. Archived files are not counted. A person with no name on any file is "Unassigned" (name null). */
export function ownerTable(rows: readonly LibraryRow[], now: number): OwnerRow[] {
  const by = new Map<string, OwnerRow>();
  rows.forEach((r) => {
    if (r.status === 'archived') return;
    const key = ownerKey(r);
    const row = by.get(key) ?? { key, name: null, total: 0, approved: 0, inForce: 0, pending: 0, lapsed: 0 };
    row.name = row.name ?? ownerOf(r);
    row.total += 1;
    const lapsed = isLapsed(r, now);
    if (r.status === 'approved') { row.approved += 1; if (!lapsed) row.inForce += 1; }
    if (r.status === 'pending_review') row.pending += 1;
    if (lapsed) row.lapsed += 1;
    by.set(key, row);
  });
  return Array.from(by.values()).sort((a, b) => b.total - a.total || Number(a.name === null) - Number(b.name === null) || (a.name ?? '').localeCompare(b.name ?? ''));      // Unassigned last on a tie
}

// ── coverage by framework ────────────────────────────────────────────────────────────────────────────────────────────────
export interface FrameworkCoverage {
  framework_id: number;
  framework_name: string;
  framework_code?: string;
  total_controls: number;
  controls_with_evidence: number;
  controls_without_evidence: number;
  coverage_percentage: number;
  /** additive: controls with approved evidence that is still in date */
  controls_with_approved_evidence?: number;
  in_force_percentage?: number;
}
export interface Coverage { total_controls: number; controls_with_evidence: number; coverage_percentage: number; controls_with_approved_evidence?: number; in_force_percentage?: number; frameworks: FrameworkCoverage[] }

/** The frameworks that have controls, the least covered first (the ones to work on), ties by name. */
export function coverageRows(coverage: Coverage | null | undefined): FrameworkCoverage[] {
  return (coverage?.frameworks ?? []).filter((f) => f.total_controls > 0).sort((a, b) => a.coverage_percentage - b.coverage_percentage || a.framework_name.localeCompare(b.framework_name));
}

/** "34 of 52 controls have evidence linked" (the old page's reading: any file, any status). */
export const coverageLine = (f: Pick<FrameworkCoverage, 'controls_with_evidence' | 'total_controls'>): string =>
  `${formatCount(f.controls_with_evidence)} of ${formatCount(f.total_controls)} ${f.total_controls === 1 ? 'control has' : 'controls have'} evidence linked`;

/** Where the Library opens for a framework (its name is the Library's framework facet value). */
export const libraryLinkForFramework = (name: string): string => `/evidence?fw=${encodeURIComponent(name)}`;
