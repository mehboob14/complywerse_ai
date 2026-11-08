// What the Risk Management Overview decides, apart from React so `node --test` pins it (overviewModel.test.ts): the counters (the server's 14, in the words and with the addresses the page
// always had, the register's ones now opening the risks they count), the person's own prioritised work built from the requests that exist (risks they hold, reviews, mitigation
// actions, KRIs to report, incidents), the module score's words, and the breakdowns of the complete register. A number is never made up: a source that failed is a state of its own.
import {
  aboveAppetite, categoryKey, categoryLabel, isMine, isUnscoredActive, isActive, levelScore, reviewOf, bandOf,
  type Band, type RiskRow, type RuleContext,
} from '../risks/_register/riskModel.ts';
import type { Tone } from '../../../../lib/status.ts';

// ── the counters ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CounterDef { key: string; label: string; href: string; tone: Tone }

/** The server's attention queue (`attention_queue` of /erm/dashboard/sections-overview): 14 counts, each opening what it counts. The two register ones and the appetite one open the
 *  register filtered (they used to open the whole list). Order: the register first, then the rest of the programme. */
export const ATTENTION: readonly CounterDef[] = [
  { key: 'critical_open_risks', label: 'Critical open risks', href: '/erm/risks?quick=critical', tone: 'danger' },
  { key: 'unscored_active_risks', label: 'Risks not fully scored', href: '/erm/risks?quick=unscored', tone: 'warning' },
  { key: 'appetite_breaches', label: 'Appetite breaches', href: '/erm/risks?quick=appetite', tone: 'danger' },
  { key: 'overdue_risk_reviews', label: 'Overdue risk reviews', href: '/erm/reviews', tone: 'warning' },
  { key: 'overdue_mitigation_actions', label: 'Overdue mitigation actions', href: '/erm/mitigation-actions', tone: 'warning' },
  { key: 'red_kris', label: 'Red KRIs', href: '/erm/kris', tone: 'danger' },
  { key: 'open_critical_incidents', label: 'Open critical incidents', href: '/erm/incidents', tone: 'danger' },
  { key: 'blocked_questions', label: 'Blocked framework questions', href: '/erm/risk-assessments?kind=framework&quick=blocked', tone: 'warning' },
  { key: 'overdue_ai_reviews', label: 'AI system reviews overdue', href: '/erm/risk-assessments/ai-risk-assessment?quick=overdue', tone: 'warning' },
  { key: 'rcsa_open_findings', label: 'RCSA open findings', href: '/erm/rcsa/findings', tone: 'warning' },
  { key: 'controls_tests_overdue', label: 'Control tests overdue', href: '/controls?mode=internal', tone: 'warning' },
  { key: 'vendor_overdue_reassessments', label: 'Vendor overdue reassessments', href: '/vendor-risk/vendors', tone: 'warning' },
  { key: 'vendor_critical_findings', label: 'Vendor critical findings', href: '/vendor-risk/findings', tone: 'danger' },
  { key: 'vendor_overdue_remediations', label: 'Vendor overdue remediations', href: '/vendor-risk/findings', tone: 'warning' },
];

export type CounterState = 'ready' | 'loading' | 'error' | 'none';
export interface CounterView { state: CounterState; value?: number }

/** One counter from the queue's payload: a missing key in an answer that arrived is "not recorded" (a dash), never 0. */
export function counterFrom(key: string, queue: Record<string, number> | undefined, loading: boolean, failed: boolean): CounterView {
  if (failed) return { state: 'error' };
  if (loading) return { state: 'loading' };
  const v = queue?.[key];
  return typeof v === 'number' ? { state: 'ready', value: v } : { state: 'none' };
}

/** The sum the server calls `total` (the band says "N need attention" only when the server gave one). */
export const attentionTotal = (queue: Record<string, number> | undefined): number | null => (typeof queue?.total === 'number' ? queue.total : null);

// ── the module score ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type Grade = 'excellent' | 'good' | 'fair' | 'poor';
export const GRADE_LABEL: Record<Grade, string> = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' };
export const GRADE_TONE: Record<Grade, Tone> = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' };

/** The grade the server gives (85 excellent, 70 good, 50 fair, else poor) and the words it said; none when it gave no score. The grade is the server's: this never re-derives it. */
export function postureOf(perf: { score?: number | null; grade?: string | null } | undefined): { score: number | null; grade: Grade | null } {
  const score = perf?.score == null ? null : Math.round(perf.score);
  const g = (perf?.grade ?? '').toLowerCase();
  return { score, grade: (['excellent', 'good', 'fair', 'poor'] as const).find((x) => x === g) ?? null };
}

export interface SectionRow { key: string; label: string; weight: number; score: number | null }

/** The section colours of the cards: >= 80 strong, >= 60 fair, below weak (the convention of the dashboards; a section with no data is "No data"). */
export function sectionBand(score: number | null | undefined): { word: 'Strong' | 'Fair' | 'Weak' | 'No data'; tone: Tone } {
  if (score == null) return { word: 'No data', tone: 'neutral' };
  if (score >= 80) return { word: 'Strong', tone: 'success' };
  if (score >= 60) return { word: 'Fair', tone: 'warning' };
  return { word: 'Weak', tone: 'danger' };
}

/** The sections that pull the score down most: the lowest scores first (no data last), the weight breaking ties. */
export function weakest(sections: readonly SectionRow[], n = 3): SectionRow[] {
  return sections.filter((s) => s.score != null).sort((a, b) => (a.score as number) - (b.score as number) || b.weight - a.weight).slice(0, n);
}

// ── the person's own work ────────────────────────────────────────────────────────────────────────────────────────────────

export type WorkKind = 'review' | 'action' | 'risk' | 'kri' | 'incident';
export const WORK_KIND: Record<WorkKind, { label: string; tone: Tone }> = {
  review: { label: 'Review', tone: 'pending' }, action: { label: 'Action', tone: 'progress' }, risk: { label: 'Risk', tone: 'warning' }, kri: { label: 'KRI', tone: 'warning' }, incident: { label: 'Incident', tone: 'danger' },
};

export interface WorkItem {
  key: string;
  kind: WorkKind;
  title: string;
  context: string;
  href: string;
  action: { label: string; href: string };
  /** naive UTC from the server; null: no date */
  due: string | null;
  overdue: boolean;
}

export interface WorkSources {
  me: number | null;
  now: Date;
  rows: readonly RiskRow[];
  ctx: RuleContext;
  reviews: readonly { id: number; risk_id: number; due_date: string; status: string; reviewer_id?: number | null; risk_title?: string | null }[];
  overdueActions: readonly { id: number; risk_id: number; title: string; owner_id?: number | null; due_date?: string | null }[];
  kriUpdates: readonly { id: number; name: string; next_due_date?: string | null; overdue?: boolean }[];
  incidents: readonly { id: number; title: string; severity?: string | null; status?: string | null; assigned_to?: number | null; incident_date?: string }[];
}

const utc = (s: string): number => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.length <= 10 ? `${s}T00:00:00Z` : `${s}Z`);
const DAY = 86_400_000;

export type Urgency = 'overdue' | 'week' | 'todo';
export const URGENCY_LABEL: Record<Urgency, string> = { overdue: 'Overdue', week: 'This week', todo: 'To do' };

export function urgencyOf(item: Pick<WorkItem, 'due' | 'overdue'>, now: Date): Urgency {
  if (item.overdue) return 'overdue';
  if (item.due) { const t = utc(item.due); if (!Number.isNaN(t) && t - now.getTime() <= 7 * DAY) return 'week'; }
  return 'todo';
}

/** The risks a person holds that need them: not fully scored, above appetite, or past the review date (one row for a risk, its reasons in its context line). */
export function riskWork(s: WorkSources): WorkItem[] {
  const out: WorkItem[] = [];
  s.rows.forEach((r) => {
    if (!isMine(r, s.me) || !isActive(r)) return;
    const reasons: string[] = [];
    if (isUnscoredActive(r)) reasons.push('Not fully scored');
    if (aboveAppetite(r, s.ctx.limits)) reasons.push('Above appetite');
    const rev = reviewOf(r, new Map(), s.now);
    if (rev.state === 'overdue') reasons.push('Review date has passed');
    if (reasons.length === 0) return;
    out.push({
      key: `risk-${r.id}`, kind: 'risk', title: r.title, context: reasons.join(' · '), href: `/erm/risks/${r.id}`,
      action: { label: reasons[0] === 'Not fully scored' ? 'Score' : reasons[0] === 'Above appetite' ? 'Treat' : 'Review', href: `/erm/risks/${r.id}?tab=${reasons[0] === 'Not fully scored' || reasons[0] === 'Above appetite' ? 'assessment' : 'overview'}` },
      due: rev.state === 'overdue' ? rev.due : null, overdue: rev.state === 'overdue',
    });
  });
  return out;
}

/** Everything that waits for the person, most urgent first: overdue (oldest date first), this week, then the rest (the riskiest first). Reviews, actions and incidents are the person's own. */
export function buildWork(s: WorkSources): WorkItem[] {
  const items: WorkItem[] = [];
  s.reviews.filter((r) => s.me != null && r.reviewer_id === s.me).forEach((r) => {
    const due = utc(r.due_date);
    items.push({
      key: `review-${r.id}`, kind: 'review', title: r.risk_title || 'A risk review', context: r.status === 'in_review' ? 'In review' : 'Waiting to start', href: `/erm/risks/${r.risk_id}`,
      action: { label: r.status === 'in_review' ? 'Complete' : 'Start', href: `/erm/reviews?review=${r.id}` }, due: r.due_date, overdue: !Number.isNaN(due) && due < s.now.getTime(),
    });
  });
  s.overdueActions.filter((a) => s.me != null && a.owner_id === s.me).forEach((a) => items.push({
    key: `action-${a.id}`, kind: 'action', title: a.title, context: 'Mitigation action is overdue', href: `/erm/risks/${a.risk_id}?tab=treatment`, action: { label: 'Open', href: `/erm/risks/${a.risk_id}?tab=treatment` }, due: a.due_date ?? null, overdue: true,
  }));
  s.kriUpdates.forEach((k) => items.push({
    key: `kri-${k.id}`, kind: 'kri', title: k.name, context: 'A value is due', href: '/erm/kris', action: { label: 'Report', href: '/erm/kris' }, due: k.next_due_date ?? null, overdue: !!k.overdue,
  }));
  s.incidents.filter((i) => s.me != null && i.assigned_to === s.me && ['open', 'investigating', 'contained'].includes((i.status || 'open').toLowerCase())).forEach((i) => items.push({
    key: `incident-${i.id}`, kind: 'incident', title: i.title, context: [i.severity ? `${i.severity.charAt(0).toUpperCase()}${i.severity.slice(1)} severity` : '', i.status ? i.status.replace(/_/g, ' ') : ''].filter(Boolean).join(' · '),
    href: '/erm/incidents', action: { label: 'Open', href: '/erm/incidents' }, due: null, overdue: false,
  }));
  items.push(...riskWork(s));

  const rank: Record<Urgency, number> = { overdue: 0, week: 1, todo: 2 };
  const level = (it: WorkItem): number => { const m = /^risk-(\d+)$/.exec(it.key); const r = m ? s.rows.find((x) => x.id === Number(m[1])) : undefined; return r ? levelScore(r) : 0; };
  return items.map((it, i) => ({ it, i, u: urgencyOf(it, s.now) }))
    .sort((a, b) => rank[a.u] - rank[b.u] || (a.it.due && b.it.due ? utc(a.it.due) - utc(b.it.due) : a.it.due ? -1 : b.it.due ? 1 : level(b.it) - level(a.it)) || a.i - b.i)
    .map((x) => x.it);
}

/** The first `limit` items with a header where the urgency changes. */
export function groupWork(items: readonly WorkItem[], now: Date, limit: number): { group: Urgency; items: WorkItem[] }[] {
  const out: { group: Urgency; items: WorkItem[] }[] = [];
  items.slice(0, limit).forEach((it) => {
    const g = urgencyOf(it, now);
    const last = out[out.length - 1];
    if (last && last.group === g) last.items.push(it);
    else out.push({ group: g, items: [it] });
  });
  return out;
}

// ── the breakdowns of the whole register ─────────────────────────────────────────────────────────────────────────────────

export interface Slice { key: string; label: string; total: number; critical: number; high: number; href: string }

function slices(rows: readonly RiskRow[], keyOf: (r: RiskRow) => { key: string; label: string } | null, param: string): Slice[] {
  const m = new Map<string, Slice>();
  rows.filter(isActive).forEach((r) => {
    const k = keyOf(r);
    if (!k) return;
    const cur = m.get(k.key) ?? { key: k.key, label: k.label, total: 0, critical: 0, high: 0, href: `/erm/risks?${param}=${encodeURIComponent(k.key)}` };
    const b: Band = bandOf(levelScore(r));
    cur.total += 1; if (b === 'critical') cur.critical += 1; if (b === 'high') cur.high += 1;
    m.set(k.key, cur);
  });
  return Array.from(m.values()).sort((a, b) => b.critical - a.critical || b.high - a.high || b.total - a.total || a.label.localeCompare(b.label));
}

/** Active risks by the category they store, the ones with the most critical and high risks first. */
export const byCategorySlices = (rows: readonly RiskRow[]): Slice[] => slices(rows, (r) => { const k = categoryKey(r); return { key: k, label: categoryLabel(k) }; }, 'cat');
/** Active risks by business unit (a risk with none is "No unit"). */
export const byUnitSlices = (rows: readonly RiskRow[]): Slice[] => slices(rows, (r) => (r.business_unit_id == null ? { key: 'none', label: 'No unit' } : { key: String(r.business_unit_id), label: r.business_unit_name || 'A unit no longer here' }), 'unit');

/** The ten highest risks by level (residual, else inherent), as the Overview's list has always meant it: every risk with a score above 0, highest first (the old list took them from the
 *  newest 100; this takes them from all). */
export function topRisks(rows: readonly RiskRow[], n = 10): RiskRow[] {
  return rows.filter((r) => levelScore(r) > 0).sort((a, b) => levelScore(b) - levelScore(a) || b.id - a.id).slice(0, n);
}

export { categoryLabel };
