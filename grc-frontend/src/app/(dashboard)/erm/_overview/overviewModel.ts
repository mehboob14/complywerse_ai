// What the Risk Management Overview decides, apart from React so `node --test` pins it (overviewModel.test.ts). Overview v2: the page says how the risk programme STANDS, in graphics.
// This file holds the numbers behind them, every one worked out from what the server sent and never made up (a figure that cannot be known is null, never 0):
//   - the six tiles: the server's module score and its grade, open risks, high and critical, above appetite, treatment on track (open mitigation actions not overdue), KRIs on target
//   - the residual matrix of the active register, the categories, the business units, the treatment states, the highest risks and the risks raised by month
//   - the ten section scores as small multiples, each opening its own page
//   - the three signals from outside the register (vendor findings, incidents, AI reviews) and the person's own work (risks they hold, reviews, actions, KRIs to report, incidents)
// Every address a graphic opens is the register's own (riskAddress.ts): the facets `status`, `level`, `cat`, `unit`, `treat`, the quick view `quick=appetite|unscored`, the matrix cell
// `cell=l-i&basis=`, and the sort. "Active" is "not closed", the server's own word for it (modules/erm/routers/dashboard.py).
import {
  aboveAppetite, bandOf, categoryKey, categoryLabel, cellBand, isActive, isMine, isUnscoredActive, levelScore, reviewOf, treatmentOf,
  type Basis, type Band, type RiskRow, type RuleContext, type Treatment,
} from '../risks/_register/riskModel.ts';
import { kriCounts, type KriLike } from '../../../../lib/erm/kri.ts';
import type { Tone } from '../../../../lib/status.ts';

// ── addresses ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The status facet that means "not closed": the register's own buckets. */
export const ACTIVE_STATUS = 'open,in_treatment,mitigated,accepted';

/** The register, filtered. Values are written plainly (a comma between the values of one facet, as the register writes them). */
export function registerHref(params: Record<string, string | number | undefined> = {}): string {
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2C/g, ',')}`);
  return `/erm/risks${q.length ? `?${q.join('&')}` : ''}`;
}
/** The open (not closed) register, with more filters on top. */
export const activeHref = (params: Record<string, string | number | undefined> = {}): string => registerHref({ status: ACTIVE_STATUS, ...params });

/** The open mitigation actions, and the key risk indicators in the green zone: the lists the two share tiles count. */
export const OPEN_ACTIONS_HREF = '/erm/mitigation-actions?quick=open';
export const GREEN_KRIS_HREF = '/erm/kris?status=green';
export const SHEET_HEALTH = '/erm?sheet=health';
export const SHEET_WORK = '/erm?sheet=work';

// ── the module score ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type Grade = 'excellent' | 'good' | 'fair' | 'poor';
export const GRADE_LABEL: Record<Grade, string> = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' };
export const GRADE_TONE: Record<Grade, Tone> = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' };
export type FigureTone = 'default' | 'success' | 'warning' | 'danger';
const GRADE_FIGURE: Record<Grade, FigureTone> = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' };

/** The grade the server gives (85 excellent, 70 good, 50 fair, else poor) and the words it said; none when it gave no score. The grade is the server's: this never re-derives it. */
export function postureOf(perf: { score?: number | null; grade?: string | null } | undefined): { score: number | null; grade: Grade | null } {
  const score = perf?.score == null ? null : Math.round(perf.score);
  const g = (perf?.grade ?? '').toLowerCase();
  return { score, grade: (['excellent', 'good', 'fair', 'poor'] as const).find((x) => x === g) ?? null };
}
export const gradeFigure = (g: Grade | null): FigureTone => (g ? GRADE_FIGURE[g] : 'default');

export interface SectionRow { key: string; label: string; weight: number; score: number | null }

/** The section colours of the cards: >= 80 strong, >= 60 fair, below weak (the convention of the dashboards; a section with no data is "No data"). */
export function sectionBand(score: number | null | undefined): { word: 'Strong' | 'Fair' | 'Weak' | 'No data'; tone: Tone } {
  if (score == null) return { word: 'No data', tone: 'neutral' };
  if (score >= 80) return { word: 'Strong', tone: 'success' };
  if (score >= 60) return { word: 'Fair', tone: 'warning' };
  return { word: 'Weak', tone: 'danger' };
}
const FIGURE_OF_TONE: Record<Tone, FigureTone> = { success: 'success', warning: 'warning', danger: 'danger', neutral: 'default', progress: 'default', pending: 'default', info: 'default' } as Record<Tone, FigureTone>;
/** The colour of a share (0 to 100) on a tile: the section bands. */
export const shareFigure = (share: number | null): FigureTone => FIGURE_OF_TONE[sectionBand(share).tone];

/** The ten sections in the order the page lists them, each with the page it opens. */
export const SECTIONS: ReadonlyArray<{ key: string; short: string; href: string }> = [
  { key: 'register', short: 'Register', href: '/erm/risks' },
  { key: 'assessments', short: 'Assessments', href: '/erm/risk-assessments' },
  { key: 'rcsa', short: 'RCSA', href: '/erm/rcsa' },
  { key: 'controls', short: 'Controls', href: '/controls?mode=internal' },
  { key: 'vendor_risk', short: 'Vendor risk', href: '/vendor-risk' },
  { key: 'kris', short: 'KRIs', href: '/erm/kris' },
  { key: 'appetite', short: 'Appetite', href: '/erm/appetite' },
  { key: 'mitigation', short: 'Mitigation', href: '/erm/mitigation-actions' },
  { key: 'reviews', short: 'Reviews', href: '/erm/reviews' },
  { key: 'incidents', short: 'Incidents', href: '/erm/incidents' },
];
export const SECTION_ORDER: readonly string[] = SECTIONS.map((s) => s.key);

export type AreaToneName = 'good' | 'warn' | 'bad' | 'neutral';
const AREA_TONE: Record<string, AreaToneName> = { success: 'good', warning: 'warn', danger: 'bad', neutral: 'neutral' };
/** The words the section tiles carry for their colours (a colour never stands alone). */
export const SECTION_WORDS = { good: 'Strong', warn: 'Fair', bad: 'Weak', neutral: 'No data' } as const;

export interface SectionTile { key: string; label: string; value: number | null; tone: AreaToneName; href: string }
/** One small multiple per section the server sent, in the page's order, named in a word or two; a section with no score is "No data", never 0. */
export function sectionTiles(sections: Record<string, { label: string; score: number | null } | undefined> | undefined): SectionTile[] {
  return SECTIONS.flatMap((s) => {
    const sec = sections?.[s.key];
    if (!sec) return [];
    const b = sectionBand(sec.score);
    return [{ key: s.key, label: s.short, value: sec.score == null ? null : Math.round(sec.score), tone: AREA_TONE[b.tone] ?? 'neutral', href: s.href }];
  });
}

// ── the six figures ──────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const utc = (s: string): number => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.length <= 10 ? `${s}T00:00:00Z` : `${s}Z`);

export interface RiskFigures {
  /** not closed */
  active: number;
  /** active, residual (else inherent) at 12 or more */
  highCritical: number;
  critical: number;
  /** scored active risks above their category's limit */
  aboveAppetite: number;
  /** active and not fully scored */
  unscored: number;
  /** risks the register has had added in the last 30 days (their own created date) */
  raised30: number;
}

/** The register's numbers from the complete lean load, with the same rules as the register's own quick views, so a tile's number is what its link shows. */
export function riskFigures(rows: readonly RiskRow[], limits: ReadonlyMap<string, number>, now: Date): RiskFigures {
  const active = rows.filter(isActive);
  const level = (r: RiskRow): Band => bandOf(levelScore(r));
  return {
    active: active.length,
    highCritical: active.filter((r) => ['critical', 'high'].includes(level(r))).length,
    critical: active.filter((r) => level(r) === 'critical').length,
    aboveAppetite: active.filter((r) => aboveAppetite(r, limits)).length,
    unscored: active.filter(isUnscoredActive).length,
    raised30: rows.filter((r) => r.created_at && now.getTime() - utc(r.created_at) <= 30 * DAY && now.getTime() - utc(r.created_at) >= 0).length,
  };
}

export interface Share { share: number | null; part: number; whole: number }

/** Open mitigation actions that are not overdue, of the open ones (the server's counts of the mitigation section). null share: there are no open actions, so "on track" says nothing. */
export function treatmentOnTrack(counts: { open?: number; overdue?: number } | undefined): Share {
  const open = counts?.open;
  if (typeof open !== 'number' || open <= 0) return { share: null, part: 0, whole: typeof open === 'number' ? open : 0 };
  const late = Math.min(open, Math.max(0, counts?.overdue ?? 0));
  return { share: Math.round(((open - late) / open) * 100), part: open - late, whole: open };
}

/** KRIs that are green, of the ones that can be judged (a value and an amber threshold: red, amber or green). null share: none can be judged. */
export function krisOnTarget(kris: readonly (KriLike & { is_active?: boolean | null })[]): Share {
  const c = kriCounts(kris.filter((k) => k.is_active !== false));
  const rated = c.red + c.amber + c.green;
  return { share: rated > 0 ? Math.round((c.green / rated) * 100) : null, part: c.green, whole: rated };
}

// ── the residual matrix ──────────────────────────────────────────────────────────────────────────────────────────────────

export const MATRIX_ROWS: readonly string[] = ['5', '4', '3', '2', '1'];
export const MATRIX_COLS: readonly string[] = ['1', '2', '3', '4', '5'];
export const BAND_COLOR = { critical: 'bad', high: 'warn', medium: 'progress', low: 'good', none: 'neutral' } as const;
export const BAND_WORD: Record<Band, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', none: 'Not scored' };

export interface Matrix { cells: number[][]; placed: number; active: number }

/** Active risks by likelihood (rows 5 down to 1) and impact (columns 1 to 5) on a basis; a risk without both numbers is not placed. */
export function matrixOf(rows: readonly RiskRow[], basis: Basis): Matrix {
  const cells = MATRIX_ROWS.map(() => MATRIX_COLS.map(() => 0));
  let placed = 0;
  const active = rows.filter(isActive);
  active.forEach((r) => {
    const l = basis === 'inherent' ? r.inherent_likelihood : r.residual_likelihood;
    const i = basis === 'inherent' ? r.inherent_impact : r.residual_impact;
    if (!l || !i || l < 1 || l > 5 || i < 1 || i > 5) return;
    cells[5 - l][i - 1] += 1;
    placed += 1;
  });
  return { cells, placed, active: active.length };
}

/** The likelihood and impact a cell stands for (row 0 is likelihood 5). */
export const cellAt = (row: number, col: number): { l: number; i: number } => ({ l: 5 - row, i: col + 1 });
export const cellLevel = (row: number, col: number): Band => { const c = cellAt(row, col); return cellBand(c.l, c.i); };
/** The register filtered to one cell of the matrix. */
export function cellHref(row: number, col: number, basis: Basis): string {
  const { l, i } = cellAt(row, col);
  return activeHref({ cell: `${l}-${i}`, basis });
}

// ── breakdowns of the active register ────────────────────────────────────────────────────────────────────────────────────

export interface Slice { key: string; label: string; total: number; critical: number; high: number; href: string }

function slices(rows: readonly RiskRow[], keyOf: (r: RiskRow) => { key: string; label: string } | null, param: string): Slice[] {
  const m = new Map<string, Slice>();
  rows.filter(isActive).forEach((r) => {
    const k = keyOf(r);
    if (!k) return;
    const cur = m.get(k.key) ?? { key: k.key, label: k.label, total: 0, critical: 0, high: 0, href: activeHref({ [param]: k.key }) };
    const b: Band = bandOf(levelScore(r));
    cur.total += 1; if (b === 'critical') cur.critical += 1; if (b === 'high') cur.high += 1;
    m.set(k.key, cur);
  });
  return Array.from(m.values()).sort((a, b) => b.total - a.total || b.critical - a.critical || b.high - a.high || a.label.localeCompare(b.label));
}

/** Active risks by the category each stores, the biggest first. */
export const byCategorySlices = (rows: readonly RiskRow[]): Slice[] => slices(rows, (r) => { const k = categoryKey(r); return { key: k, label: categoryLabel(k) }; }, 'cat');
/** Active risks by business unit, the biggest first (a risk with none is "No unit"). */
export const byUnitSlices = (rows: readonly RiskRow[]): Slice[] => slices(rows, (r) => (r.business_unit_id == null ? { key: 'none', label: 'No unit' } : { key: String(r.business_unit_id), label: r.business_unit_name || 'A unit no longer here' }), 'unit');

export const TREATMENT_WORD: Record<Treatment, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
export interface TreatmentPart { key: Treatment; label: string; value: number; href: string }
/** Active risks by treatment state (what the risk page derives: a plan with the risk mitigated is completed, a plan is in progress, else not started). */
export function treatmentParts(rows: readonly RiskRow[]): TreatmentPart[] {
  const n: Record<Treatment, number> = { not_started: 0, in_progress: 0, completed: 0 };
  rows.filter(isActive).forEach((r) => { n[treatmentOf(r)] += 1; });
  return (['not_started', 'in_progress', 'completed'] as const).map((key) => ({ key, label: TREATMENT_WORD[key], value: n[key], href: activeHref({ treat: key }) }));
}

/** The highest risks by level (residual, else inherent), every active risk with a score, the highest first (the newest first among equals). */
export function topRisks(rows: readonly RiskRow[], n = 5): RiskRow[] {
  return rows.filter((r) => isActive(r) && levelScore(r) > 0).sort((a, b) => levelScore(b) - levelScore(a) || b.id - a.id).slice(0, n);
}

export interface Month { key: string; label: string; value: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Risks raised in each of the last `months` calendar months (by the date each was created), oldest first, counted for every risk of the register: the register's own history, so it has
 *  as many months as the register has had. A month with none is a real 0. null: no risk carries a created date, so there is no history to draw. */
export function raisedByMonth(rows: readonly RiskRow[], now: Date, months = 12): Month[] | null {
  const dated = rows.filter((r) => r.created_at && !Number.isNaN(utc(r.created_at)));
  if (dated.length === 0) return null;
  const slots: Month[] = [];
  for (let k = months - 1; k >= 0; k -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    slots.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || k === months - 1 ? ` ${String(d.getUTCFullYear()).slice(2)}` : ''}`, value: 0 });
  }
  dated.forEach((r) => {
    const d = new Date(utc(r.created_at as string));
    const slot = slots.find((s) => s.key === `${d.getUTCFullYear()}-${d.getUTCMonth()}`);
    if (slot) slot.value += 1;
  });
  return slots;
}

// ── signals from outside the register ────────────────────────────────────────────────────────────────────────────────────

export interface SignalDef { key: string; label: string; href: string; info: string }
/** Three counts the server keeps in its attention queue that belong to other modules. */
export const SIGNALS: readonly SignalDef[] = [
  { key: 'vendor_critical_findings', label: 'Critical vendor findings', href: '/vendor-risk/findings?severity=critical', info: 'Open critical findings on third-party vendors.' },
  { key: 'open_critical_incidents', label: 'Critical incidents', href: '/erm/incidents?quick=severe', info: 'Open incidents of critical or high severity.' },
  { key: 'overdue_ai_reviews', label: 'AI reviews overdue', href: '/erm/risk-assessments/ai-risk-assessment?quick=overdue', info: 'AI system entries past their review date.' },
];

export type SignalState = 'ready' | 'loading' | 'error' | 'none';
export interface SignalView { state: SignalState; value?: number }

/** One signal from the queue's payload: a missing key in an answer that arrived is "not recorded", never 0. */
export function signalFrom(key: string, queue: Record<string, number> | undefined, loading: boolean, failed: boolean): SignalView {
  if (failed) return { state: 'error' };
  if (loading) return { state: 'loading' };
  const v = queue?.[key];
  return typeof v === 'number' ? { state: 'ready', value: v } : { state: 'none' };
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

/** The first `limit` items with a header where the urgency changes (the full list in the "My work" sheet). */
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

export { categoryLabel };
