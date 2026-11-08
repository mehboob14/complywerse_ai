// What the Risk Assessments home and workspaces decide, apart from React so `node --test` pins it (assessmentModel.test.ts).
//
// ONE band system for the whole area: the Risk Register's (critical >= 20, high >= 12, medium >= 6, low below, "not scored" when there is no score), imported from
// risks/_register/riskModel.ts so there is a single definition (the old assessment page used 21 / 13 / 6, the AI register 15 / 8). The level of an assessed risk is read at its
// residual score, else its inherent score (the register's own rule), and it is COMPUTED, never read from the stored rating: the tiles, the rows, the Insights view and the
// rating written on a save all call `ratingOf`, so a tile can never disagree with the rows under it.
//
// The averages divide by their own counts (the inherent average over the rows that have an inherent score, the residual average over the rows that have a residual score);
// the reduction exists only when both averages do. A "stage" folds the framework assessments' three words into the five of a manual assessment so that one facet, one counter
// and one board can carry both kinds.
import { BANDS, bandOf, levelScore, type Band } from '../../risks/_register/riskModel.ts';
import { flag, listOf, oneOf, text, type ParamSpec } from '../../../../../lib/addressState.ts';

export { BANDS, bandOf, levelScore };
export type { Band };

// ── the rows of the home ─────────────────────────────────────────────────────────────────────────────────────────────────

export type Kind = 'manual' | 'framework';

/** One row of GET /erm/risk-assessments/register. */
export interface AssessmentRow {
  kind: Kind;
  id: number;
  name: string;
  status: string;
  description_preview?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  framework_name?: string | null;
  business_unit_name?: string | null;
  assessment_type?: string | null;
  methodology?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  approver_name?: string | null;
  approved_at?: string | null;
  /** risks assessed (manual) or questions (framework) */
  total_items: number;
  /** risks with a residual score (manual) or questions completed (framework) */
  done_items: number;
  blocked_items: number;
  /** questions assigned to the signed-in person that are not completed */
  mine_items: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AssessmentRegister { items: AssessmentRow[]; total: number; truncated: boolean }

/** A number unique across both kinds (a manual assessment 5 and a framework assessment 5 are two records). Even = manual, odd = framework. */
export const keyOf = (r: Pick<AssessmentRow, 'kind' | 'id'>): number => r.id * 2 + (r.kind === 'framework' ? 1 : 0);
/** The address form of a row: m12, f3. */
export const refOf = (r: Pick<AssessmentRow, 'kind' | 'id'>): string => `${r.kind === 'framework' ? 'f' : 'm'}${r.id}`;
export function parseRef(ref: string | null | undefined): { kind: Kind; id: number } | null {
  const m = /^([mf])(\d{1,9})$/.exec((ref ?? '').trim());
  return m && Number(m[2]) > 0 ? { kind: m[1] === 'f' ? 'framework' : 'manual', id: Number(m[2]) } : null;
}
export const hrefOf = (r: Pick<AssessmentRow, 'kind' | 'id'>): string => (r.kind === 'framework' ? `/erm/risk-assessments/framework/${r.id}` : `/erm/risk-assessments/${r.id}`);

// ── stages: one vocabulary for both kinds ────────────────────────────────────────────────────────────────────────────────

export type Stage = 'draft' | 'in_progress' | 'under_review' | 'approved' | 'closed';
export const STAGES: readonly Stage[] = ['draft', 'in_progress', 'under_review', 'approved', 'closed'];
export const STAGE_LABEL: Record<Stage, string> = {
  draft: 'Draft', in_progress: 'In progress', under_review: 'Under review', approved: 'Approved or completed', closed: 'Closed or archived',
};

const norm = (s: string | null | undefined): string => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** The stage of a status: a framework assessment's completed is approved, archived is closed, not_started is draft. A word nobody knows is "in progress" (it is open work). */
export function stageOf(kind: Kind, status: string | null | undefined): Stage {
  const s = norm(status);
  if (kind === 'framework') {
    if (s === 'completed') return 'approved';
    if (s === 'archived') return 'closed';
    if (s === 'not_started') return 'draft';
    return 'in_progress';
  }
  return (STAGES as readonly string[]).includes(s) ? (s as Stage) : s === 'completed' ? 'approved' : 'in_progress';
}
export const isFinished = (r: Pick<AssessmentRow, 'kind' | 'status'>): boolean => ['approved', 'closed'].includes(stageOf(r.kind, r.status));

// ── progress ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Progress { done: number; total: number; pct: number | null; unit: 'risks' | 'questions' }
export function progressOf(r: Pick<AssessmentRow, 'kind' | 'total_items' | 'done_items'>): Progress {
  const total = Math.max(0, r.total_items || 0);
  const done = Math.min(Math.max(0, r.done_items || 0), total);
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : null, unit: r.kind === 'framework' ? 'questions' : 'risks' };
}
/** "18 of 40 questions answered" / "9 of 14 risks scored" / "No risks yet". */
export function progressWords(r: Pick<AssessmentRow, 'kind' | 'total_items' | 'done_items'>): string {
  const p = progressOf(r);
  if (p.total === 0) return r.kind === 'framework' ? 'No questions yet' : 'No risks yet';
  return r.kind === 'framework' ? `${p.done} of ${p.total} answered` : `${p.done} of ${p.total} scored`;
}

// ── the facets and quick views ───────────────────────────────────────────────────────────────────────────────────────────

export const NO_OWNER = 'none';
export const NO_FRAMEWORK = 'none';

export type QuickId = 'all' | 'mine' | 'progress' | 'review' | 'blocked' | 'empty';
export const QUICK_IDS: readonly QuickId[] = ['all', 'mine', 'progress', 'review', 'blocked', 'empty'];
export const QUICK_LABEL: Record<QuickId, string> = {
  all: 'All', mine: 'Assigned to me', progress: 'In progress', review: 'Under review', blocked: 'Blocked questions', empty: 'Nothing in them yet',
};

export interface RuleContext { me: number | null }

/** The people the quick view "Assigned to me" means: the one who leads a manual assessment or made a framework one, or who has a question to answer. */
export function inQuick(id: QuickId, r: AssessmentRow, ctx: RuleContext): boolean {
  switch (id) {
    case 'all': return true;
    case 'mine': return r.mine_items > 0 || (ctx.me != null && r.owner_id === ctx.me && !isFinished(r));
    case 'progress': return stageOf(r.kind, r.status) === 'in_progress';
    case 'review': return stageOf(r.kind, r.status) === 'under_review';
    case 'blocked': return r.blocked_items > 0;
    case 'empty': return r.total_items === 0 && !isFinished(r);
  }
}

export const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const searchTerms = (q: string): string[] => fold(q.trim()).split(/\s+/).filter(Boolean);
export const haystack = (r: AssessmentRow): string =>
  fold([r.name, r.description_preview, r.owner_name, r.framework_name, r.business_unit_name, r.methodology, r.assessment_type].filter(Boolean).join(' '));

// ── sorting ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SORT_KEYS = ['updated', 'name', 'status', 'owner', 'progress', 'created'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';
export interface Sort { key: SortKey; dir: SortDir }
export const DEFAULT_SORT: Sort = { key: 'updated', dir: 'desc' };
export const SORT_LABEL: Record<SortKey, string> = { updated: 'Last changed', name: 'Name', status: 'Status', owner: 'Owner', progress: 'Progress', created: 'Created' };
export const FIRST_DIR: Record<SortKey, SortDir> = { updated: 'desc', name: 'asc', status: 'asc', owner: 'asc', progress: 'asc', created: 'desc' };

/** The next order when a column is pressed: its first direction, then the other, then back to the default. */
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key !== key) return { key, dir: FIRST_DIR[key] };
  if (cur.dir === FIRST_DIR[key]) return { key, dir: FIRST_DIR[key] === 'asc' ? 'desc' : 'asc' };
  return DEFAULT_SORT;
}

const cmpText = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
const cmpDate = (a: string | null | undefined, b: string | null | undefined): number => (a ?? '').localeCompare(b ?? '');

export function sortRows(rows: readonly AssessmentRow[], sort: Sort): AssessmentRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const by = (a: AssessmentRow, b: AssessmentRow): number => {
    switch (sort.key) {
      case 'name': return cmpText(a.name, b.name);
      case 'status': return STAGES.indexOf(stageOf(a.kind, a.status)) - STAGES.indexOf(stageOf(b.kind, b.status));
      case 'owner': {
        if (!a.owner_name && !b.owner_name) return 0;
        if (!a.owner_name) return 1;                                            // nobody is last in either direction's reading: handled below
        if (!b.owner_name) return -1;
        return cmpText(a.owner_name, b.owner_name);
      }
      case 'progress': return (progressOf(a).pct ?? -1) - (progressOf(b).pct ?? -1);
      case 'created': return cmpDate(a.created_at, b.created_at);
      default: return cmpDate(a.updated_at, b.updated_at);
    }
  };
  return rows.slice().sort((a, b) => {
    if (sort.key === 'owner' && (!a.owner_name || !b.owner_name) && a.owner_name !== b.owner_name) return !a.owner_name ? 1 : -1;      // an unowned assessment is last whichever way
    return dir * by(a, b) || cmpText(a.name, b.name) || a.id - b.id;
  });
}

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const VIEWS = ['list', 'board', 'insights'] as const;
export type RegisterView = (typeof VIEWS)[number];

const sort = (): ParamSpec<Sort> => ({
  default: DEFAULT_SORT,
  read: ([first]) => {
    const [key, dir, ...rest] = (first ?? '').trim().split(':');
    return rest.length === 0 && (SORT_KEYS as readonly string[]).includes(key) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : undefined;
  },
  write: (v) => (v.key === DEFAULT_SORT.key && v.dir === DEFAULT_SORT.dir ? [] : [`${v.key}:${v.dir}`]),
});
const quick = (): ParamSpec<QuickId | null> => ({
  default: null,
  read: ([first]) => ((QUICK_IDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as QuickId) : undefined),
  write: (v) => (v && v !== 'all' ? [v] : []),
});

/** ?q=iso&kind=framework&status=in_progress,under_review&owner=7&fw=ISO%2027005&quick=blocked&sort=name:asc&view=board&open=f12&new=framework|manual|import&tab=assigned.
 *  Defined once, outside any component. `tab=assigned` is the old "Assigned To Me" tab of the framework page; `new` opens the create panels. */
export const REGISTER_SCHEMA = {
  q: text(),
  kind: listOf(['manual', 'framework']),
  status: listOf(STAGES),
  owner: listOf(),
  fw: listOf(),
  quick: quick(),
  sort: sort(),
  view: oneOf(VIEWS, 'list'),
  open: text(),
  new: oneOf(['', 'framework', 'manual', 'import'] as const, ''),
  tab: text(),
  upload: flag(),
};

export interface Filters { search: string; kind: string[]; status: string[]; owner: string[]; framework: string[]; quick: QuickId | null }
export const NO_FILTERS: Filters = { search: '', kind: [], status: [], owner: [], framework: [], quick: null };

export interface RegisterAddress {
  q: string; kind: string[]; status: string[]; owner: string[]; fw: string[]; quick: QuickId | null; sort: Sort; view: RegisterView; open: string; new: '' | 'framework' | 'manual' | 'import'; tab: string; upload: boolean;
}
export interface RegisterPage { filters: Filters; sort: Sort; view: RegisterView; open: { kind: Kind; id: number } | null; create: '' | 'framework' | 'manual' | 'import' }

/** What the address says. The old framework page's `?tab=assigned` is the quick view "Assigned to me"; the old `?upload` is the import panel. */
export function pageOf(a: RegisterAddress): RegisterPage {
  const q: QuickId | null = a.quick ?? (a.tab.trim() === 'assigned' ? 'mine' : null);
  return {
    filters: { search: a.q, kind: a.kind, status: a.status, owner: a.owner, framework: a.fw, quick: q },
    sort: a.sort,
    view: a.view,
    open: parseRef(a.open),
    create: a.new || (a.upload ? 'import' : ''),
  };
}
export const filtersPatch = (f: Filters): Partial<RegisterAddress> => ({ q: f.search, kind: f.kind, status: f.status, owner: f.owner, fw: f.framework, quick: f.quick, tab: '' });

export function filterCount(f: Filters): number {
  return f.kind.length + f.status.length + f.owner.length + f.framework.length + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}

/** The plain filter the facet engine is held to by a test: every row that passes every facet and the rule. */
export function plainFilter(rows: readonly AssessmentRow[], f: Filters, ctx: RuleContext): AssessmentRow[] {
  const terms = searchTerms(f.search);
  return rows.filter((r) => {
    if (f.kind.length && !f.kind.includes(r.kind)) return false;
    if (f.status.length && !f.status.includes(stageOf(r.kind, r.status))) return false;
    if (f.owner.length && !f.owner.includes(r.owner_id == null ? NO_OWNER : String(r.owner_id))) return false;
    if (f.framework.length && !f.framework.includes(r.framework_name?.trim() || NO_FRAMEWORK)) return false;
    if (f.quick && f.quick !== 'all' && !inQuick(f.quick, r, ctx)) return false;
    const text = haystack(r);
    return terms.every((t) => text.includes(t));
  });
}

// ── Insights: the figures of the old dashboard, over the rows the person is looking at ─────────────────────────────────

export interface Insight {
  total: number;
  manual: number;
  framework: number;
  byStage: Record<Stage, number>;
  risksAssessed: number;
  questions: number;
  questionsDone: number;
  blocked: number;
  /** the dashboard's `risks_per_assessment_avg` and `questions_per_assessment_avg` (one decimal) */
  risksPerAssessment: number;
  questionsPerAssessment: number;
  byType: Array<{ label: string; count: number }>;
  byMethodology: Array<{ label: string; count: number }>;
  byFramework: Array<{ label: string; count: number }>;
  byOwner: Array<{ label: string; count: number }>;
  /** the last 12 months, oldest first: assessments created in each */
  trend: Array<{ month: string; count: number }>;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const tally = (items: Array<string | null | undefined>, empty: string, limit = 10): Array<{ label: string; count: number }> => {
  const m = new Map<string, number>();
  items.forEach((x) => { const k = (x ?? '').trim() || empty; m.set(k, (m.get(k) ?? 0) + 1); });
  return Array.from(m.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || cmpText(a.label, b.label)).slice(0, limit);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function insightsOf(rows: readonly AssessmentRow[], today: Date = new Date()): Insight {
  const manual = rows.filter((r) => r.kind === 'manual');
  const fw = rows.filter((r) => r.kind === 'framework');
  const byStage = { draft: 0, in_progress: 0, under_review: 0, approved: 0, closed: 0 } as Record<Stage, number>;
  rows.forEach((r) => { byStage[stageOf(r.kind, r.status)] += 1; });
  const risksAssessed = manual.reduce((n, r) => n + r.total_items, 0);
  const questions = fw.reduce((n, r) => n + r.total_items, 0);
  const trend: Insight['trend'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    trend.push({ month: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, count: 0 });
  }
  rows.forEach((r) => {
    const at = (r.created_at ?? '').slice(0, 7);
    if (at.length !== 7) return;
    const label = `${MONTHS[Number(at.slice(5)) - 1]} ${at.slice(0, 4)}`;
    const slot = trend.find((t) => t.month === label);
    if (slot) slot.count += 1;
  });
  return {
    total: rows.length,
    manual: manual.length,
    framework: fw.length,
    byStage,
    risksAssessed,
    questions,
    questionsDone: fw.reduce((n, r) => n + r.done_items, 0),
    blocked: rows.reduce((n, r) => n + r.blocked_items, 0),
    risksPerAssessment: manual.length ? round1(risksAssessed / manual.length) : 0,
    questionsPerAssessment: fw.length ? round1(questions / fw.length) : 0,
    byType: tally(manual.map((r) => (r.assessment_type || 'periodic').replace(/_/g, ' ')), 'Not set'),
    byMethodology: tally(manual.map((r) => (r.methodology || '').replace(/_/g, ' ')), 'Not set'),
    byFramework: tally(fw.map((r) => r.framework_name), 'Not set'),
    byOwner: tally(rows.map((r) => r.owner_name), 'Unassigned'),
    trend,
  };
}

// ── an assessment's risks (the manual workspace) ─────────────────────────────────────────────────────────────────────────

export interface AssessedRisk {
  id: number;
  risk_id: number;
  risk_title?: string | null;
  risk_category?: string | null;
  inherent_likelihood?: number | null;
  inherent_impact?: number | null;
  inherent_score?: number | null;
  residual_likelihood?: number | null;
  residual_impact?: number | null;
  residual_score?: number | null;
  risk_rating?: string | null;
  treatment_decision?: string | null;
  rationale?: string | null;
  control_effectiveness?: string | null;
  notes?: string | null;
  assessed_by?: number | null;
  assessed_at?: string | null;
  linked_kris?: Array<{ id: number; kri_id: number; kri_name?: string | null; observed_value?: number | null; threshold_status?: string | null; notes?: string | null }>;
  linked_incidents?: Array<{ id: number; incident_id: number; incident_title?: string | null; incident_severity?: string | null; impact_on_rating?: string | null }>;
  linked_rcsa_findings?: Array<{ id: number; rcsa_finding_id: number; finding_title?: string | null; finding_severity?: string | null; relevance_notes?: string | null }>;
}

type Axes = Pick<AssessedRisk, 'inherent_likelihood' | 'inherent_impact' | 'inherent_score' | 'residual_likelihood' | 'residual_impact' | 'residual_score'>;

/** likelihood x impact when both are set; null otherwise. */
export const scoreOf = (l: number | null | undefined, i: number | null | undefined): number | null => (l && i ? l * i : null);

/** The inherent score of a row: from its axes; an imported row that has a score and no axes keeps its score; one axis alone is no score. */
export function inherentOf(r: Axes): number | null {
  const s = scoreOf(r.inherent_likelihood, r.inherent_impact);
  if (s != null) return s;
  return r.inherent_likelihood || r.inherent_impact ? null : r.inherent_score ?? null;
}
export function residualOf(r: Axes): number | null {
  const s = scoreOf(r.residual_likelihood, r.residual_impact);
  if (s != null) return s;
  return r.residual_likelihood || r.residual_impact ? null : r.residual_score ?? null;
}

/** THE rating: the band of the residual score, else the inherent score. */
export const ratingOf = (r: Axes): Band => bandOf(levelScore({ residual_score: residualOf(r), inherent_score: inherentOf(r) }));

export interface Summary {
  total: number;
  byBand: Record<Band, number>;
  scored: number;
  avgInherent: number | null;
  avgResidual: number | null;
  /** average inherent - average residual, only when both exist */
  reduction: number | null;
  byTreatment: Record<string, number>;
  byEffectiveness: Record<string, number>;
}

const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

export function summarise(rows: readonly Partial<AssessedRisk>[]): Summary {
  const byBand = { critical: 0, high: 0, medium: 0, low: 0, none: 0 } as Record<Band, number>;
  const inh: number[] = [];
  const res: number[] = [];
  const byTreatment: Record<string, number> = { accept: 0, mitigate: 0, transfer: 0, avoid: 0, undecided: 0 };
  const byEffectiveness: Record<string, number> = { effective: 0, partially_effective: 0, ineffective: 0, unrated: 0 };
  rows.forEach((r) => {
    byBand[ratingOf(r)] += 1;
    const i = inherentOf(r);
    const s = residualOf(r);
    if (i != null) inh.push(i);
    if (s != null) res.push(s);
    const t = norm(r.treatment_decision);
    byTreatment[t in byTreatment ? t : 'undecided'] += 1;
    const e = norm(r.control_effectiveness);
    byEffectiveness[e in byEffectiveness ? e : 'unrated'] += 1;
  });
  const avgInherent = avg(inh);
  const avgResidual = avg(res);
  return {
    total: rows.length,
    byBand,
    scored: rows.length - byBand.none,
    avgInherent,
    avgResidual,
    reduction: avgInherent != null && avgResidual != null ? Math.round((avgInherent - avgResidual) * 100) / 100 : null,
    byTreatment,
    byEffectiveness,
  };
}

/** The fields one in-place edit of a row sends: the change itself and the rating that follows from the scores after it (so the stored rating is always the shown one). */
export type RowPatch = Partial<Pick<AssessedRisk, 'inherent_likelihood' | 'inherent_impact' | 'residual_likelihood' | 'residual_impact' | 'treatment_decision' | 'control_effectiveness' | 'rationale' | 'notes'>>;
export function patchBody(row: AssessedRisk, patch: RowPatch): Record<string, unknown> {
  const after = { ...row, ...patch };
  const scoring = ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact'].some((k) => k in patch);
  const band = ratingOf(after);
  return scoring ? { ...patch, risk_rating: band === 'none' ? null : band } : { ...patch };
}

/** The row with an edit applied, as the table shows it before the server has answered. */
export function applyPatch(row: AssessedRisk, patch: RowPatch): AssessedRisk {
  const next = { ...row, ...patch };
  next.inherent_score = scoreOf(next.inherent_likelihood, next.inherent_impact) ?? (next.inherent_likelihood || next.inherent_impact ? null : next.inherent_score ?? null);
  next.residual_score = scoreOf(next.residual_likelihood, next.residual_impact) ?? (next.residual_likelihood || next.residual_impact ? null : next.residual_score ?? null);
  return next;
}

/** Whether the person can still change the scores of an assessment: the same rule the page always had (draft and in progress). */
export const isEditable = (status: string | null | undefined): boolean => ['draft', 'in_progress'].includes(norm(status));

/** What the lifecycle offers from a status: [status to move to, button words, tone]. The server's own table (VALID_STATUS_TRANSITIONS). */
export interface Move { to: string; label: string; primary?: boolean; danger?: boolean; confirm?: string }
export function movesFrom(status: string | null | undefined): Move[] {
  switch (norm(status)) {
    case 'draft': return [{ to: 'in_progress', label: 'Start assessment', primary: true }];
    case 'in_progress': return [{ to: 'under_review', label: 'Submit for review', primary: true }];
    case 'under_review': return [{ to: 'approved', label: 'Approve', primary: true }, { to: 'in_progress', label: 'Send back' }];
    case 'approved': return [{ to: 'closed', label: 'Close' }];
    default: return [];
  }
}

/** Which of an assessment's steps it is at, for the stepper under the title. */
export const STEPS: ReadonlyArray<{ stage: Stage; label: string }> = [
  { stage: 'draft', label: 'Draft' }, { stage: 'in_progress', label: 'In progress' }, { stage: 'under_review', label: 'Under review' }, { stage: 'approved', label: 'Approved' }, { stage: 'closed', label: 'Closed' },
];

// ── where an AI answer came from ─────────────────────────────────────────────────────────────────────────────────────────

/** `source` is what the server says ("ai" or "rules"); an answer without one (an older server) is "unknown" and is not claimed to be either. */
export function sourceOf(answer: { source?: string | null } | null | undefined): 'ai' | 'rules' | 'unknown' {
  const s = norm(answer?.source);
  return s === 'ai' ? 'ai' : s === 'rules' || s === 'rule_based' ? 'rules' : 'unknown';
}

/** What a failed AI request says, by what happened. The server's own text (it can carry an exception, a vendor or a model name) is never shown. */
export function aiFailureWords(status: number | undefined): string {
  if (status === 403) return 'You are not allowed to use the AI here.';
  if (status === 400 || status === 422) return 'The AI has nothing to suggest for this one.';
  if (status === 429) return 'The AI is busy. Try again in a minute.';
  return 'The AI could not draft this right now. Try again, or fill it in yourself.';
}
