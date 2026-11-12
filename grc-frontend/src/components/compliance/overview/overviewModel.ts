// What the Compliance Overview decides, apart from React so `node --test` pins it (overviewModel.test.ts): the module score's words, the areas of the score and the page each is worked on, one row
// per framework journey (every Ready / Implemented figure comes from lib/journeyModel.ts, the one definition) and the four buckets the server adds up as "needs attention", which the Performance
// Overview still reads (lib/perf/moduleFeeds.ts). A number is never made up: a request that failed or has not answered is a state of its own, never 0.
import {
  isActiveJourney, journeyNumbers, portfolioNumbers, readinessBand, targetState,
  type JourneyProgressPayload, type ReadinessBand, type TargetState,
} from '../../../lib/journeyModel.ts';
import type { Tone } from '../../../lib/status.ts';

// ── the strip between the Overview and the pages it opens ────────────────────────────────────────────────────────────────

export interface StripItem { key: 'overview' | 'controls' | 'library' | 'statements' | 'assurance'; label: string; href: string }
/** The Overview and the four pages it used to open from tiles (P-23: they had no door but the Overview). */
export const STRIP: readonly StripItem[] = [
  { key: 'overview', label: 'Overview', href: '/compliance' },
  { key: 'controls', label: 'Controls', href: '/controls' },
  { key: 'library', label: 'Control Library', href: '/control-library' },
  { key: 'statements', label: 'Statements', href: '/compliance/statements' },
  { key: 'assurance', label: 'Assurance', href: '/control-library/assurance' },
];

// ── the counters ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CounterDef { key: string; label: string; href: string; tone: Tone; from: 'scorecard' | 'evidence' }

/** The four buckets the server adds up for "needs attention" (dashboard.py: controls without evidence + stale evidence + overdue control tests + overdue regulatory tasks). This page no longer draws them
 *  as a band (Overview v2: attention is the colour of the posture graphics, the numbers ride on the area tiles); the Performance Overview reads the definitions. Stale evidence is read from the evidence
 *  summary's `lapsed_count` (a file past its validity, worked out when it is read) because the stored flag the scorecard counts is set by nobody. */
export const ATTENTION: readonly CounterDef[] = [
  { key: 'controls_without_evidence', label: 'Controls without evidence', href: '/controls', tone: 'warning', from: 'scorecard' },
  { key: 'evidence_lapsed', label: 'Lapsed evidence', href: '/evidence?fresh=lapsed', tone: 'danger', from: 'evidence' },
  { key: 'overdue_control_tests', label: 'Overdue control tests', href: '/control-library/assurance', tone: 'warning', from: 'scorecard' },
  { key: 'regulatory_overdue_tasks', label: 'Overdue regulatory tasks', href: '/governance/regulatory-changes', tone: 'danger', from: 'scorecard' },
];

export interface EvidenceMonth { month: string; uploaded?: number; approved?: number }
export interface EvidenceSummaryLite {
  lapsed_count?: number; stale_count?: number; expiring_soon_count?: number; pending_review_count?: number;
  /** what the graphs read (the same answer the Evidence library reads): every file, its statuses, the ones in force, and six months of uploads and approvals */
  total_count?: number; in_force_count?: number; by_status?: Record<string, number>; by_month?: EvidenceMonth[];
}

// ── the worklist ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The inbox sources Compliance owns: evidence to approve. Documents and sign-offs are Governance's (its Overview narrows to those two). */
export const COMPLIANCE_SOURCES: readonly 'assessment.evidence'[] = ['assessment.evidence'];

// ── the module score ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type Grade = 'excellent' | 'good' | 'fair' | 'poor';
export const GRADE_LABEL: Record<Grade, string> = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' };
export const GRADE_TONE: Record<Grade, Tone> = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' };

export interface PerformanceLite { score?: number | null; grade?: string | null; components?: ReadonlyArray<{ target?: number | null }> }

/** The score the server computed, rounded, and the grade it gave (85 excellent, 70 good, 50 fair, else poor): never worked out here again. */
export function postureOf(perf: PerformanceLite | null | undefined): { score: number | null; grade: Grade | null } {
  const score = typeof perf?.score === 'number' ? Math.round(perf.score) : null;
  const g = String(perf?.grade ?? '').toLowerCase();
  return { score, grade: (['excellent', 'good', 'fair', 'poor'] as const).find((x) => x === g) ?? null };
}

/** The target the server scored against (every component carries the tenant's target, 85 unless it was set); null when the answer has none. */
export function targetOf(perf: PerformanceLite | null | undefined): number | null {
  const t = (perf?.components ?? []).map((c) => c.target).find((x) => typeof x === 'number' && x > 0);
  return typeof t === 'number' ? t : null;
}

export const SECTION_ORDER = ['frameworks', 'controls', 'effectiveness', 'evidence', 'control_library', 'regulatory'] as const;
/** Where each area of the score is worked on. Effectiveness used to open the Control Library, the same page as Library (P-23); it opens Control Testing & Assurance. */
export const SECTION_HREF: Record<string, string> = {
  frameworks: '/frameworks', controls: '/controls', effectiveness: '/control-library/assurance', evidence: '/evidence', control_library: '/control-library', regulatory: '/governance/regulatory-changes',
};

export interface SectionRow { key: string; label: string; weight: number; score: number | null }

/** The areas that are in the answer, in the order the score lists them. */
export function sectionRows(sections: Record<string, { key?: string; label?: string; weight?: number; score?: number | null }> | null | undefined): SectionRow[] {
  const out: SectionRow[] = [];
  SECTION_ORDER.forEach((k) => {
    const s = sections?.[k];
    if (s) out.push({ key: k, label: s.label ?? k, weight: typeof s.weight === 'number' ? s.weight : 0, score: typeof s.score === 'number' ? s.score : null });
  });
  return out;
}

export type AreaWord = 'strong' | 'fair' | 'weak' | 'no_data';
/** The colour line of the dashboards: 80 and over strong, 60 and over fair, below weak; an area with no score is "no data", not weak. */
export function areaWord(score: number | null | undefined): AreaWord {
  if (typeof score !== 'number') return 'no_data';
  return score >= 80 ? 'strong' : score >= 60 ? 'fair' : 'weak';
}

// ── one row per framework journey ────────────────────────────────────────────────────────────────────────────────────────

export interface JourneyListItem { id: number; name?: string | null; status?: string | null; target_date?: string | null; progress?: JourneyProgressPayload | null }
export interface JourneyRow {
  id: number;
  name: string;
  status: string;
  active: boolean;
  /** Ready %: requirements whose approved evidence reaches what they ask for (the journey function); null when the list sent no progress for it */
  ready: number | null;
  implemented: number | null;
  /** requirements in scope */
  applicable: number | null;
  band: ReadinessBand | null;
  target: TargetState;
  href: string;
}

/** Active journeys first, the most urgent on top (a target date that has passed, then one within 30 days, then the lowest Ready %), a journey with no progress after them, then the
 *  finished ones. One definition of the figures: lib/journeyModel.ts. */
export function journeyRows(list: readonly JourneyListItem[] | null | undefined, today: Date = new Date()): JourneyRow[] {
  const rows = (list ?? []).map((j): JourneyRow => {
    const n = journeyNumbers(j.progress);
    const status = j.status ?? '';
    return {
      id: j.id, name: (j.name ?? '').trim() || 'Untitled journey', status, active: isActiveJourney(status),
      ready: n ? n.readyPct : null, implemented: n ? n.implementedPct : null, applicable: n ? n.applicable : null,
      band: n ? readinessBand(n.readyPct) : null, target: targetState(j.target_date, status, today), href: `/frameworks/${j.id}`,
    };
  });
  const urgency = (r: JourneyRow) => (r.target.state === 'overdue' ? 0 : r.target.state === 'soon' ? 1 : 2);
  return rows.sort((a, b) =>
    Number(b.active) - Number(a.active)
    || (a.active ? urgency(a) - urgency(b) : 0)
    || (a.ready === null ? 1 : 0) - (b.ready === null ? 1 : 0)
    || (a.ready ?? 0) - (b.ready ?? 0)
    || a.name.localeCompare(b.name));
}

export interface PortfolioLine { journeys: number; completed: number; missing: number; ready: number; implemented: number }

/** The line over the journeys that still have work in them: controls-weighted (the journey model's rule), and how many are finished. */
export function portfolioLine(list: readonly JourneyListItem[] | null | undefined): PortfolioLine {
  const rows = list ?? [];
  const p = portfolioNumbers(rows, { activeOnly: true });
  return { journeys: p.journeys, completed: rows.filter((r) => !isActiveJourney(r.status)).length, missing: p.missing, ready: p.readyPct, implemented: p.implementedPct };
}
