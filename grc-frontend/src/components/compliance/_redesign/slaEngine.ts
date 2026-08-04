// Dynamic-SLA / closure engine (framework-agnostic, pure functions).
//
// Every assessment point carries its own timeline, so we never blend points
// into one score. Instead each point has an SLA state relative to a reference
// ("as-of") time T:
//   • closed    — closed on/before T
//   • overdue   — open and its target date is before T
//   • due_soon  — open and target within the horizon after T
//   • on_track  — open and target later than the horizon
//   • no_date   — open with no derivable target date
//
// Target date = explicit target_date, else (date raised + policy days for the
// point's priority tier). Closed date = explicit closed_at, else updated_at
// when the point's status already reads closed/complied (back-compat for rows
// that pre-date the closed_at column). All times are epoch-ms; the caller owns
// the as-of slider, so recompute is instant and client-side.

export interface SlaPolicy {
  critical_days: number;
  high_days: number;
  medium_days: number;
  low_days: number;
  due_soon_days: number;
  // Point-score weights (0-100) — user-tunable; drive the bottom-up score.
  score_closed_ontime?: number;
  score_closed_late?: number;
  score_on_track?: number;
  score_due_soon?: number;
  score_overdue?: number;
  score_no_date?: number;
}

export const DEFAULT_SLA_POLICY: SlaPolicy = {
  critical_days: 30,
  high_days: 60,
  medium_days: 90,
  low_days: 180,
  due_soon_days: 30,
  score_closed_ontime: 100,
  score_closed_late: 70,
  score_on_track: 40,
  score_due_soon: 20,
  score_overdue: 0,
  score_no_date: 30,
};

export type SlaState = 'overdue' | 'due_soon' | 'on_track' | 'closed' | 'no_date';

export interface SlaItemInput {
  priority?: string | null;
  compliance_status?: string | null;
  remediation_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  target_date?: string | null;
  closed_at?: string | null;
  /** The point's own due date as authored in the workbook. Mixed formats:
   *  ISO ("2025-09-30"), quarter ("Q2-2025" / "Q2 2025"), or year ("2022"). */
  timeline?: string | null;
}

const DAY = 86_400_000;

function toMs(s?: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Parse a point's own `timeline` due date. Handles ISO dates, quarters
 *  (Q1-Q4, mapped to the last day of the quarter) and bare years (year-end).
 *  Returns epoch-ms or null when blank/unparseable. */
export function parseTimelineMs(s?: string | null): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  // Quarter: "Q2-2025", "Q2 2025", "2025-Q2"
  const q = t.match(/Q\s*([1-4])[\s-]*'?(\d{4})/i) || t.match(/(\d{4})[\s-]*Q\s*([1-4])/i);
  if (q) {
    let quarter: number; let year: number;
    if (/^Q/i.test(t)) { quarter = parseInt(q[1], 10); year = parseInt(q[2], 10); }
    else { year = parseInt(q[1], 10); quarter = parseInt(q[2], 10); }
    const endMonth = quarter * 3; // Q1->3, Q2->6, Q3->9, Q4->12
    return new Date(year, endMonth, 0).getTime(); // day 0 of next month = last day of quarter
  }
  // Bare year: "2022"
  if (/^\d{4}$/.test(t)) return new Date(parseInt(t, 10), 11, 31).getTime();
  // ISO or other Date-parseable
  const iso = Date.parse(t);
  return Number.isNaN(iso) ? null : iso;
}

function tierDays(priority: string | null | undefined, p: SlaPolicy): number {
  switch ((priority || '').toLowerCase()) {
    case 'critical': return p.critical_days;
    case 'high': return p.high_days;
    case 'low': return p.low_days;
    case 'medium': return p.medium_days;
    default: return p.medium_days; // unknown/blank tiers default to Medium
  }
}

function isClosedByStatus(item: SlaItemInput): boolean {
  return (item.remediation_status || '').toLowerCase() === 'closed'
    || (item.compliance_status || '') === 'complied';
}

/** The point's own deadline in epoch-ms. Order of truth:
 *  1. explicit `target_date` (a user override),
 *  2. the point's authored `timeline` due date (the real independent date),
 *  3. policy fallback (raised date + tier days) only when it has no date at all. */
export function effectiveTargetMs(item: SlaItemInput, p: SlaPolicy): number | null {
  const explicit = toMs(item.target_date);
  if (explicit != null) return explicit;
  const own = parseTimelineMs(item.timeline);
  if (own != null) return own;
  const raised = toMs(item.created_at);
  if (raised == null) return null;
  return raised + tierDays(item.priority, p) * DAY;
}

/** When the point was closed in epoch-ms, or null if still open. */
export function effectiveClosedMs(item: SlaItemInput): number | null {
  const explicit = toMs(item.closed_at);
  if (explicit != null) return explicit;
  if (isClosedByStatus(item)) return toMs(item.updated_at) ?? toMs(item.created_at);
  return null;
}

export interface PointSla {
  state: SlaState;
  targetMs: number | null;
  closedMs: number | null;
  raisedMs: number | null;
  daysToTarget: number | null; // signed: negative = overdue
}

export function computePointSla(
  item: SlaItemInput, asOf: number, horizonDays: number, p: SlaPolicy,
): PointSla {
  const raisedMs = toMs(item.created_at);
  const targetMs = effectiveTargetMs(item, p);
  const closedMs = effectiveClosedMs(item);
  if (closedMs != null && closedMs <= asOf) {
    return { state: 'closed', targetMs, closedMs, raisedMs, daysToTarget: targetMs != null ? Math.round((targetMs - asOf) / DAY) : null };
  }
  if (targetMs == null) return { state: 'no_date', targetMs: null, closedMs, raisedMs, daysToTarget: null };
  const days = Math.round((targetMs - asOf) / DAY);
  const state: SlaState = days < 0 ? 'overdue' : (days <= horizonDays ? 'due_soon' : 'on_track');
  return { state, targetMs, closedMs, raisedMs, daysToTarget: days };
}

export interface SlaAging { overdue: number; d30: number; d60: number; d90: number; later: number; noDate: number }

export interface SlaRollup {
  total: number;
  open: number;
  closed: number;
  overdue: number;
  dueSoon: number;
  onTrack: number;
  noDate: number;
  closureRate: number; // closed / total, 0..100
  aging: SlaAging;
}

function addToBucket(days: number, a: SlaAging) {
  if (days < 0) a.overdue++;
  else if (days <= 30) a.d30++;
  else if (days <= 60) a.d60++;
  else if (days <= 90) a.d90++;
  else a.later++;
}

/** Roll a set of points up to counts/aging as of a given time + horizon.
 *  Every point is always counted — only its state (overdue / closed / …) is
 *  evaluated as of `asOf`. We deliberately do NOT exclude by created_at,
 *  because created_at is the upload date, not when the finding was raised;
 *  excluding by it made time-travel before the upload date zero everything out. */
export function computeRollup(
  items: SlaItemInput[], asOf: number, horizonDays: number, p: SlaPolicy,
): SlaRollup {
  const r: SlaRollup = {
    total: 0, open: 0, closed: 0, overdue: 0, dueSoon: 0, onTrack: 0, noDate: 0, closureRate: 0,
    aging: { overdue: 0, d30: 0, d60: 0, d90: 0, later: 0, noDate: 0 },
  };
  for (const it of items) {
    r.total++;
    const s = computePointSla(it, asOf, horizonDays, p);
    if (s.state === 'closed') { r.closed++; continue; }
    r.open++;
    if (s.state === 'overdue') { r.overdue++; r.aging.overdue++; }
    else if (s.state === 'due_soon') { r.dueSoon++; addToBucket(s.daysToTarget as number, r.aging); }
    else if (s.state === 'on_track') { r.onTrack++; addToBucket(s.daysToTarget as number, r.aging); }
    else { r.noDate++; r.aging.noDate++; }
  }
  r.closureRate = r.total ? Math.round((r.closed / r.total) * 100) : 0;
  return r;
}

/* ── Bottom-up scoring ─────────────────────────────────────────────────────
   Each point earns its OWN score from its date-vs-status (respecting its own
   timeline). Domain score = simple average of its points' scores. Assessment
   score = simple average of its domain scores. Never a flat cross-cycle count. */

export const POINT_SCORE = {
  closedOnTime: 100, // done on/before its own deadline
  closedLate: 70,    // done, but missed the deadline
  onTrack: 40,       // open, deadline still comfortably ahead
  dueSoon: 20,       // open, deadline within the horizon
  overdue: 0,        // open, deadline already passed
  noDate: 30,        // open, no derivable deadline
};

function w(p: SlaPolicy, key: keyof typeof POINT_SCORE, policyKey: keyof SlaPolicy): number {
  const v = p[policyKey];
  return typeof v === 'number' ? v : POINT_SCORE[key];
}

/** A single point's score (0–100) from its state vs its own date. Weights come
 *  from the (user-tunable) policy, falling back to the POINT_SCORE defaults. */
export function pointScore(item: SlaItemInput, asOf: number, horizonDays: number, p: SlaPolicy): number {
  const s = computePointSla(item, asOf, horizonDays, p);
  if (s.state === 'closed') {
    const onTime = s.targetMs == null || (s.closedMs != null && s.closedMs <= s.targetMs);
    return onTime ? w(p, 'closedOnTime', 'score_closed_ontime') : w(p, 'closedLate', 'score_closed_late');
  }
  if (s.state === 'overdue') return w(p, 'overdue', 'score_overdue');
  if (s.state === 'due_soon') return w(p, 'dueSoon', 'score_due_soon');
  if (s.state === 'on_track') return w(p, 'onTrack', 'score_on_track');
  return w(p, 'noDate', 'score_no_date');
}

/** Simple average of the point scores (points not yet raised as of asOf are
 *  excluded). Returns null when there is nothing to score. */
export function averageScore(items: SlaItemInput[], asOf: number, horizonDays: number, p: SlaPolicy): number | null {
  let sum = 0; let n = 0;
  for (const it of items) {
    sum += pointScore(it, asOf, horizonDays, p); n++;
  }
  return n ? Math.round(sum / n) : null;
}

/** Assessment score = simple average of each domain's average score. */
export function rollupScore(
  items: SlaItemInput[], asOf: number, horizonDays: number, p: SlaPolicy,
  domainOf: (it: SlaItemInput) => string,
): number | null {
  const byDomain = new Map<string, SlaItemInput[]>();
  for (const it of items) {
    const d = domainOf(it) || 'Uncategorized';
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(it);
  }
  const domainScores: number[] = [];
  for (const arr of byDomain.values()) {
    const s = averageScore(arr, asOf, horizonDays, p);
    if (s != null) domainScores.push(s);
  }
  return domainScores.length ? Math.round(domainScores.reduce((a, b) => a + b, 0) / domainScores.length) : null;
}

/** Slider bounds: from the earliest raised date to the latest target (padded). */
export function timelineBounds(items: SlaItemInput[], p: SlaPolicy): { minMs: number; maxMs: number } {
  const now = Date.now();
  let min = Infinity;
  let max = -Infinity;
  for (const it of items) {
    const raised = toMs(it.created_at);
    const tg = effectiveTargetMs(it, p);
    // Both raised and target dates shape the span so the scrubber can reach
    // back to when the oldest point was actually due (real dates can be years old).
    for (const ms of [raised, tg]) {
      if (ms != null) { min = Math.min(min, ms); max = Math.max(max, ms); }
    }
  }
  if (!Number.isFinite(min)) min = now - 90 * DAY;
  if (!Number.isFinite(max)) max = now + 180 * DAY;
  min = Math.min(min, now - 7 * DAY);
  max = Math.max(max, now) + 14 * DAY;
  return { minMs: min, maxMs: max };
}

export const SLA_STATE_META: Record<SlaState, { label: string; color: string; bg: string }> = {
  overdue: { label: 'Overdue', color: '#e11d48', bg: '#fff1f2' },
  due_soon: { label: 'Due soon', color: '#b45309', bg: '#fffbeb' },
  on_track: { label: 'On track', color: '#0369a1', bg: '#eff6ff' },
  closed: { label: 'Closed', color: '#047857', bg: '#ecfdf5' },
  no_date: { label: 'No date', color: '#64748b', bg: '#f8fafc' },
};

export function fmtDate(ms: number | null): string {
  if (ms == null) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
