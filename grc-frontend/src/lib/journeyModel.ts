// journeyModel.ts - ONE pure model for every number and rule of a framework journey, so the journey page, the Frameworks hub and the Compliance
// overview say the same thing about the same journey. No React, no requests: `node --test src/lib/journeyModel.test.ts` runs it.
//
// THE definition (F-readiness, the owner's "recommended options", 2026-11-08): a journey's numbers are the numbers of the server's journey function
// (certification_router.calculate_progress_summary), which every list, detail and chart payload of a journey carries as `progress`:
//   - applicable = total - not applicable (a requirement the organisation put out of scope, or marked not applicable, is not counted at all);
//   - Implemented % = implemented / applicable, where "implemented" ALREADY includes the verified ones (a verified requirement is counted once);
//   - Ready % = requirements whose APPROVED evidence reaches what the requirement asks for / applicable (a file nobody approved is not readiness).
// Anything else a page used to show for "readiness" (the Dashboard's "any approved evidence", the aggregate's status-only not-applicable, the
// unweighted mean of journeys) is retired: see `portfolioNumbers` for the figure over several journeys. The page that holds the payload reads it
// with `journeyNumbers`; a payload that is missing is `null`, never zeros.
import { parseUtc } from './serverTime.ts';

// ── the numbers of one journey ───────────────────────────────────────────────

/** What a journey payload carries as `progress`: the journey function's keys, plus the legacy keys only the journey DETAIL adds. All optional: a
 *  payload from an older server, or a list row without it, still reads. */
export interface JourneyProgressPayload {
  total_controls?: number;
  implemented_count?: number; verified_count?: number; in_progress_count?: number; not_started_count?: number; not_applicable_count?: number;
  completion_percentage?: number; readiness_percentage?: number; evidence_coverage_percentage?: number;
  with_evidence_count?: number; fully_evidenced_count?: number; approved_evidence_controls?: number;
  implemented?: number; verified?: number; in_progress?: number; not_started?: number; not_applicable?: number;
  by_domain?: Array<{ domain_id?: string | number; domain_name?: string; total?: number; completed?: number; in_progress?: number; not_started?: number }>;
}

export interface JourneyNumbers {
  /** every requirement of the journey, the ones out of scope included */
  total: number;
  /** total - notApplicable: the denominator of every percentage */
  applicable: number;
  notApplicable: number;
  /** implemented AND verified, counted once */
  implemented: number;
  /** of the implemented, the ones a reviewer verified (a subset: never added to `implemented`) */
  verified: number;
  inProgress: number;
  /** applicable requirements nobody has started (never negative) */
  toStart: number;
  withEvidence: number;
  fullyEvidenced: number;
  /** requirements whose approved evidence reaches what they ask for: the numerator of Ready */
  approved: number;
  /** Implemented %, one decimal, 0-100 */
  implementedPct: number;
  /** Ready %, one decimal, 0-100 */
  readyPct: number;
  /** requirements with all the evidence they ask for (approved or not), one decimal */
  evidencePct: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const first = (...v: unknown[]): number | null => { for (const x of v) { const n = num(x); if (n !== null) return n; } return null; };
/** n over d as a percent with one decimal (the server rounds the same way); 0 when there is nothing to divide by. */
export const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const clamp01 = (n: number): number => Math.max(0, Math.min(100, n));

/** The numbers of a journey from its `progress` payload; `null` when there is no payload or it has no requirement count (a failed or pending
 *  load is "no answer", which a page shows as such, never as an empty journey). A percentage the server did not send is worked out from the
 *  counts it did send, by the same rule. */
export function journeyNumbers(progress: JourneyProgressPayload | null | undefined): JourneyNumbers | null {
  if (!progress || typeof progress !== 'object') return null;
  const total = num(progress.total_controls);
  if (total === null) return null;
  const notApplicable = first(progress.not_applicable_count, progress.not_applicable) ?? 0;
  const applicable = Math.max(0, total - notApplicable);
  const implemented = first(progress.implemented_count, progress.implemented) ?? 0;
  const verified = first(progress.verified_count, progress.verified) ?? 0;
  const inProgress = first(progress.in_progress_count, progress.in_progress) ?? 0;
  const approved = num(progress.approved_evidence_controls) ?? 0;
  const fullyEvidenced = num(progress.fully_evidenced_count) ?? 0;
  const toStart = first(progress.not_started_count, progress.not_started) ?? Math.max(0, applicable - implemented - inProgress);
  return {
    total, applicable, notApplicable, implemented, verified, inProgress, toStart,
    withEvidence: num(progress.with_evidence_count) ?? 0, fullyEvidenced, approved,
    implementedPct: clamp01(num(progress.completion_percentage) ?? pct(implemented, applicable)),
    readyPct: clamp01(num(progress.readiness_percentage) ?? pct(approved, applicable)),
    evidencePct: clamp01(num(progress.evidence_coverage_percentage) ?? pct(fullyEvidenced, applicable)),
  };
}

/** How ready a journey is, in four words: ONE set of lines for every page (the old pages drew six: 80/50/25, 75/50/25, 75/40, 80/60...). */
export type ReadinessBand = 'strong' | 'building' | 'early' | 'start';
export const READINESS_LINES = { strong: 75, building: 50, early: 25 } as const;
export function readinessBand(readyPct: number | null | undefined): ReadinessBand {
  const v = num(readyPct);
  if (v === null || v < READINESS_LINES.early) return 'start';
  if (v >= READINESS_LINES.strong) return 'strong';
  return v >= READINESS_LINES.building ? 'building' : 'early';
}

/** A journey that still has work in it: the figures over several journeys (open gaps, the hero gauge) count these only. */
export function isActiveJourney(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s !== 'completed' && s !== 'cancelled';
}

export interface PortfolioNumbers {
  /** journeys that were counted */
  journeys: number;
  /** journeys whose payload had no progress (not counted, said as such) */
  missing: number;
  applicable: number; implemented: number; approved: number;
  /** requirements still to do on the journeys that were counted: not started plus in progress */
  open: number;
  /** controls-weighted: all implemented over all applicable (a 400-requirement framework counts for more than a 20-requirement one) */
  implementedPct: number;
  /** controls-weighted: all with approved evidence over all applicable */
  readyPct: number;
}

/** The figure over several journeys, by the same rule as one: sums of the journeys' own counts, then one division. `activeOnly` (the default)
 *  leaves out a completed or cancelled journey; a row with no `progress` is `missing`, not zero. */
export function portfolioNumbers(
  rows: ReadonlyArray<{ status?: string | null; progress?: JourneyProgressPayload | null }>,
  { activeOnly = true }: { activeOnly?: boolean } = {},
): PortfolioNumbers {
  const out: PortfolioNumbers = { journeys: 0, missing: 0, applicable: 0, implemented: 0, approved: 0, open: 0, implementedPct: 0, readyPct: 0 };
  for (const row of rows) {
    if (activeOnly && !isActiveJourney(row.status)) continue;
    const n = journeyNumbers(row.progress);
    if (!n) { out.missing += 1; continue; }
    out.journeys += 1;
    out.applicable += n.applicable; out.implemented += n.implemented; out.approved += n.approved;
    out.open += n.toStart + n.inProgress;
  }
  out.implementedPct = pct(out.implemented, out.applicable);
  out.readyPct = pct(out.approved, out.applicable);
  return out;
}

// ── the target date ──────────────────────────────────────────────────────────

export interface TargetState {
  /** the day as written, "2026-11-12", or null */
  day: string | null;
  /** whole calendar days from today to the day (negative: past); null with no date */
  days: number | null;
  /** 'none' | 'overdue' | 'soon' (30 days or fewer: the line the dashboard always used) | 'later' | 'done' (the journey is completed) */
  state: 'none' | 'overdue' | 'soon' | 'later' | 'done';
}

/** The target date is a DAY that arrives as a DateTime ("2026-11-12T00:00:00"): the day as written, whatever the viewer's zone. */
export function targetState(target: string | null | undefined, status: string | null | undefined, today: Date = new Date()): TargetState {
  const m = typeof target === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(target.trim()) : null;
  if (!m) return { day: null, days: null, state: 'none' };
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const days = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
  if (String(status ?? '').toLowerCase() === 'completed') return { day, days, state: 'done' };
  return { day, days, state: days < 0 ? 'overdue' : days <= 30 ? 'soon' : 'later' };
}

// ── the tabs of the journey page ─────────────────────────────────────────────

/** The tabs every journey has. 'journey' is the landing tab of a framework with an authored flow; 'overview' the landing tab of the others.
 *  'controls' stays the key of Requirements: `?tab=controls` is written by the page itself and linked from My Work, so it must keep working. */
export const CORE_TABS = ['journey', 'overview', 'controls', 'scope', 'artifacts', 'activity'] as const;
export type CoreTab = (typeof CORE_TABS)[number];
/** the framework's own registers and documents live behind this one tab; `?item=` names the one that is open */
export const REGISTERS_TAB = 'registers';

/** Old names that still arrive from bookmarks and emails: the tabs of the page before 2026-11 that were never reachable, and now have a home. */
export const TAB_ALIASES: Readonly<Record<string, string>> = {
  applicability: 'scope', soa: 'scope', scoping: 'scope',
  history: 'activity',
  phases: 'overview',
  'assigned-to-me': 'controls', 'cde-scope': 'controls',
};

export interface JourneyTabsInput {
  /** the framework has an authored end-to-end flow (matchFrameworkFlow found one) */
  hasFlow: boolean;
  /** the types of the framework's registers and documents (empty: no 'registers' tab) */
  templateKeys: readonly string[];
}

/** Which tabs are on offer, in order. The landing tab is the first of Journey (with a flow) or Overview (without). A framework with a flow has BOTH
 *  Journey and Overview (before, the flow replaced the Overview, which hid the charts, the AI overview and the critical-clause analysis). */
export function journeyTabKeys({ hasFlow, templateKeys }: JourneyTabsInput): string[] {
  const keys: string[] = [];
  if (hasFlow) keys.push('journey');
  keys.push('overview', 'controls', 'scope');
  if (templateKeys.length > 0) keys.push(REGISTERS_TAB);
  keys.push('artifacts', 'activity');
  return keys;
}

export const landingTab = (hasFlow: boolean): string => (hasFlow ? 'journey' : 'overview');

/** The aliases for one journey: the fixed old names, plus every register/document type that used to be a tab of its own (`?tab=risk_register`
 *  opens Registers with that item open). */
export function aliasesFor(templateKeys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = { ...TAB_ALIASES };
  for (const key of templateKeys) out[key] = REGISTERS_TAB;
  return out;
}

/** The register or document that is open: `?item=` when it is one of this framework's, else a legacy `?tab=<type>`, else the first. */
export function openItem(search: string, templateKeys: readonly string[]): string | null {
  if (templateKeys.length === 0) return null;
  const q = new URLSearchParams(search);
  const item = q.get('item');
  if (item && templateKeys.indexOf(item) >= 0) return item;
  const legacy = q.get('tab');
  if (legacy && templateKeys.indexOf(legacy) >= 0) return legacy;
  return templateKeys[0];
}

// ── the stages of an authored flow ───────────────────────────────────────────

export interface FlowPhaseLike { n: number; name: string; coverage: string; deliverables: string[]; evidence: string[]; owner: string; ext: boolean }
export interface StageOwnerLike { type?: string; ref_id?: number | null; label?: string }
export interface StageRow {
  n: number; name: string; coverage: string; external: boolean;
  deliverables: number; artifacts: number;
  /** the owner the organisation chose, or null: the flow's own owner is only a suggestion */
  owner: string | null;
  suggestedOwner: string;
}
export interface StageSummary { stages: number; withOwner: number; withoutOwner: number; external: number }

/** The stages of the flow with what is KNOWN about each: its owner (chosen or not) and how many deliverables and artifacts it lists. There is no
 *  "Done / In progress / Upcoming" here: the platform does not track a stage, and the old badge was worked out from one percentage (stage i is
 *  done if i < floor(ratio x stages)), which an auditor would read as a fact. */
export function stageRows(phases: readonly FlowPhaseLike[], owners: Readonly<Record<string, StageOwnerLike>> | null | undefined): StageRow[] {
  return phases.map((p) => {
    const chosen = owners ? owners[String(p.n)] : undefined;
    const label = chosen && typeof chosen.label === 'string' ? chosen.label.trim() : '';
    return {
      n: p.n, name: p.name, coverage: p.coverage, external: !!p.ext,
      deliverables: (p.deliverables || []).length, artifacts: (p.evidence || []).length,
      owner: label || null, suggestedOwner: p.owner,
    };
  });
}
export function stageSummary(rows: readonly StageRow[]): StageSummary {
  const withOwner = rows.filter((r) => r.owner).length;
  return { stages: rows.length, withOwner, withoutOwner: rows.length - withOwner, external: rows.filter((r) => r.external).length };
}

// ── what is waiting for the person ───────────────────────────────────────────

export interface ControlLite {
  id: number;
  control_code?: string; control_name?: string; status?: string; is_applicable?: boolean; is_critical?: boolean;
  priority_level?: string | null; parsed_control_id?: number | null;
  assigned_user_ids?: number[] | null; assigned_to_user_id?: number | null;
  evidence?: Array<{ id: number; review_status?: string | null }> | null;
}

const DONE = ['implemented', 'verified', 'not_applicable'];
const inScope = (c: ControlLite): boolean => c.is_applicable !== false;
const assigned = (c: ControlLite): number[] => (c.assigned_user_ids && c.assigned_user_ids.length ? c.assigned_user_ids : c.assigned_to_user_id ? [c.assigned_to_user_id] : []);

/** The requirements the journey page lists: the ones the organisation has not put out of scope. This is the Requirements tab's count. */
export const requirementCount = (controls: readonly ControlLite[] | null | undefined): number => (controls || []).filter(inScope).length;

export interface ScopeRecordLite {
  id: number; control_id: number; is_applicable: boolean; status: 'pending' | 'approved' | 'rejected' | string;
  requested_at?: string | null; reviewed_at?: string | null;
}

export interface WaitingInput {
  controls: readonly ControlLite[] | null | undefined;
  userId: number | null;
  /** the person may review evidence and scope decisions (the page's `frameworks:framework_library:edit`); without it only their own requirements wait */
  canReview: boolean;
  records: readonly ScopeRecordLite[] | null | undefined;
}
export interface Waiting {
  /** applicable requirements assigned to the person that are not done, critical first, then by priority tier and code */
  mine: ControlLite[];
  /** controls with evidence nobody has approved or rejected yet; `evidence` counts the files */
  toReview: Array<{ control: ControlLite; evidence: number }>;
  evidenceToReview: number;
  /** scope decisions waiting for a reviewer, oldest first */
  decisions: ScopeRecordLite[];
  /** what "N need you" counts: mine + files to review + decisions */
  total: number;
}

const tier = (c: ControlLite): number => { const m = /^P(\d)$/.exec(c.priority_level || ''); return m ? +m[1] : 9; };

export function waitingForMe({ controls, userId, canReview, records }: WaitingInput): Waiting {
  const all = (controls || []).filter(inScope);
  const mine = userId === null ? [] : all
    .filter((c) => DONE.indexOf(c.status || '') < 0 && assigned(c).indexOf(userId) >= 0)
    .sort((a, b) => Number(!!b.is_critical) - Number(!!a.is_critical) || tier(a) - tier(b) || (a.control_code || '').localeCompare(b.control_code || '', undefined, { numeric: true }));
  const toReview = canReview
    ? all.map((control) => ({ control, evidence: (control.evidence || []).filter((e) => e.review_status === 'pending').length })).filter((x) => x.evidence > 0)
    : [];
  const evidenceToReview = toReview.reduce((s, x) => s + x.evidence, 0);
  const decisions = canReview
    ? (records || []).filter((r) => r.status === 'pending').slice().sort((a, b) => String(a.requested_at || '').localeCompare(String(b.requested_at || '')) || a.id - b.id)
    : [];
  return { mine, toReview, evidenceToReview, decisions, total: mine.length + evidenceToReview + decisions.length };
}

// ── scope decisions ──────────────────────────────────────────────────────────

export type ScopeFilter = 'pending' | 'all' | 'approved' | 'rejected' | 'out';
export const SCOPE_FILTERS: ReadonlyArray<{ key: ScopeFilter; label: string }> = [
  { key: 'pending', label: 'Waiting' }, { key: 'all', label: 'All' }, { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' }, { key: 'out', label: 'Out of scope' },
];

export interface ScopeCounts { pending: number; approved: number; rejected: number; out: number; all: number }
export function scopeCounts(records: readonly ScopeRecordLite[] | null | undefined): ScopeCounts {
  const list = records || [];
  return {
    all: list.length,
    pending: list.filter((r) => r.status === 'pending').length,
    approved: list.filter((r) => r.status === 'approved').length,
    rejected: list.filter((r) => r.status === 'rejected').length,
    out: list.filter((r) => r.status === 'approved' && !r.is_applicable).length,
  };
}

/** The decisions a filter shows, in the order a reviewer works them: the waiting ones OLDEST first (a queue), every other list newest first. */
export function scopeList<T extends ScopeRecordLite>(records: readonly T[] | null | undefined, filter: ScopeFilter): T[] {
  const list = (records || []).filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'out') return r.status === 'approved' && !r.is_applicable;
    return r.status === filter;
  });
  const when = (r: T) => String(r.status === 'pending' ? r.requested_at || '' : r.reviewed_at || r.requested_at || '');
  return list.slice().sort((a, b) => (filter === 'pending' ? when(a).localeCompare(when(b)) : when(b).localeCompare(when(a))) || a.id - b.id);
}

/** What the decision does once it is settled, in plain words. The server saves EVERY decision as waiting; the requirement changes only when a
 *  reviewer approves it, so until then it stays as it is. */
export function scopeEffect(record: Pick<ScopeRecordLite, 'is_applicable' | 'status'>, requirementInScope: boolean | null): string {
  const asked = record.is_applicable ? 'in scope' : 'out of scope';
  if (record.status === 'approved') return record.is_applicable ? 'The requirement is in scope.' : 'The requirement is out of scope and left out of every figure.';
  if (record.status === 'rejected') return `The request to put it ${asked} was turned down; the requirement stays ${requirementInScope === false ? 'out of scope' : 'in scope'}.`;
  const now = requirementInScope === null ? '' : requirementInScope ? 'in scope' : 'out of scope';
  return `Until a reviewer decides, the requirement stays${now ? ` ${now}` : ' as it is'}. If it is approved it goes ${asked}.`;
}

/** The control a decision is about: decisions are keyed by the library clause (`parsed_control_id`), the journey lists its own row ids. */
export function controlOfDecision<C extends ControlLite>(record: Pick<ScopeRecordLite, 'control_id'>, controls: readonly C[] | null | undefined): C | null {
  return (controls || []).find((c) => c.parsed_control_id === record.control_id) ?? null;
}

// ── recent activity ──────────────────────────────────────────────────────────

export interface ActivityItem { at: string; text: string; kind: 'decision' | 'snapshot'; tab: 'scope' | 'activity' }

/** The latest things that happened on the journey, newest first, from what the page has already loaded (no request of its own). */
export function recentActivity(input: {
  records: readonly (ScopeRecordLite & { control_reference?: string | null; requested_by_name?: string | null; reviewed_by_name?: string | null })[] | null | undefined;
  snapshots: ReadonlyArray<{ id: number; label?: string | null; year?: number | null; captured_at?: string | null; overall_pct?: number | null }> | null | undefined;
  limit?: number;
}): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const r of input.records || []) {
    const ref = r.control_reference || 'a requirement';
    if (r.status === 'pending' && r.requested_at) items.push({ at: r.requested_at, kind: 'decision', tab: 'scope', text: `${r.requested_by_name || 'Someone'} asked to put ${ref} ${r.is_applicable ? 'in' : 'out of'} scope` });
    else if (r.reviewed_at) items.push({ at: r.reviewed_at, kind: 'decision', tab: 'scope', text: `${r.reviewed_by_name || 'A reviewer'} ${r.status === 'approved' ? 'approved' : 'turned down'} the scope request for ${ref}` });
  }
  for (const s of input.snapshots || []) {
    if (s.captured_at) items.push({ at: s.captured_at, kind: 'snapshot', tab: 'activity', text: `Snapshot "${s.label || s.year || 'Snapshot'}" captured${typeof s.overall_pct === 'number' ? ` at ${s.overall_pct}%` : ''}` });
  }
  const when = (x: ActivityItem) => (parseUtc(x.at)?.getTime() ?? 0);
  return items.sort((a, b) => when(b) - when(a)).slice(0, input.limit ?? 6);
}
