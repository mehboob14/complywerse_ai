// What the Risk Register decides, apart from React so `node --test` pins it (riskModel.test.ts): the row the lean list gives (GET /erm/risks?lean=1), the ONE score-band system
// (critical >= 20, high >= 12, medium >= 6, low below, the same cuts as the server's dashboards and `risk_priority_for_score`), the status buckets, the category a risk STORES,
// who "mine" is, the rules behind the quick views (above appetite, review overdue, unowned, unscored ...), the treatment state, sorting and the CSV of a selection.
//
// The numbers are the server's, written once. Each rule names the file it comes from:
//   level of a risk        residual score, else inherent, else none        modules/erm/routers/risks.py (by-register: `residual_score or inherent_score or 0`)
//   status buckets         open / in_treatment / mitigated / accepted / closed   risks.py `_bucket_status`
//   active                 status is not closed                             routers/dashboard.py (`active`)
//   fully scored           both the inherent and the residual score exist   routers/dashboard.py (`scored`)
//   critical open          active, scored, residual >= 20                   routers/dashboard.py (`critical_open`)
//   above appetite         scored active, residual > the category's limit   routers/dashboard.py (`appetite_breaches`: limit = tolerance, else max acceptable, else 12)

/** One row of the lean list. The long text (description in full, root cause, treatment plan ...) is on the detail endpoint. */
export interface RiskRow {
  id: number;
  tenant_id?: number;
  title: string;
  description_preview?: string | null;
  category?: string | null;
  risk_category?: string | null;
  risk_sub_category?: string | null;
  register_type?: string | null;
  source_type?: string | null;
  status?: string | null;
  priority?: string | null;
  effective_priority?: string | null;
  closure_status?: string | null;
  is_material?: boolean;
  inherent_likelihood?: number | null;
  inherent_impact?: number | null;
  inherent_score?: number | null;
  residual_likelihood?: number | null;
  residual_impact?: number | null;
  residual_score?: number | null;
  owner_id?: number | null;
  owner_name?: string | null;
  business_owner_id?: number | null;
  business_owner_name?: string | null;
  business_unit_id?: number | null;
  business_unit_name?: string | null;
  due_date?: string | null;
  review_date?: string | null;
  has_plan?: boolean;
  sla?: { state?: string | null; days_overdue?: number | null; due_in_days?: number | null; due_date?: string | null } | null;
  framework_ids?: number[];
  in_assessment?: boolean;
  actions_total?: number;
  actions_open?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

/** The envelope of `GET /erm/risks?lean=1`. */
export interface LeanRisks {
  items: RiskRow[];
  total: number;
  skip?: number;
  limit?: number;
  truncated?: boolean;
  lean?: boolean;
  frameworks?: Record<string, { name: string }>;
}

// ── the score bands ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type Band = 'critical' | 'high' | 'medium' | 'low' | 'none';
export const BANDS: readonly Band[] = ['critical', 'high', 'medium', 'low', 'none'];
export const CRITICAL_AT = 20;
export const HIGH_AT = 12;
export const MEDIUM_AT = 6;

/** The band of a score (likelihood x impact, 1-25). No score (null, 0) is "none": an unscored risk is not "low". */
export function bandOf(score: number | null | undefined): Band {
  const s = Number(score ?? 0);
  if (!(s > 0)) return 'none';
  if (s >= CRITICAL_AT) return 'critical';
  if (s >= HIGH_AT) return 'high';
  if (s >= MEDIUM_AT) return 'medium';
  return 'low';
}

/** The score a risk is read at: the residual, else the inherent (the server's dashboards do the same). 0 when it has neither. */
export function levelScore(r: Pick<RiskRow, 'residual_score' | 'inherent_score'>): number {
  return Number(r.residual_score || r.inherent_score || 0);
}
export const levelOf = (r: Pick<RiskRow, 'residual_score' | 'inherent_score'>): Band => bandOf(levelScore(r));

/** The server's severity count: unscored risks fall in "low" there (`else`). Insights shows them apart; this is the number the old dashboard called Low. */
export const serverLow = (counts: { low: number; none: number }): number => counts.low + counts.none;

// ── status ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type StatusBucket = 'open' | 'in_treatment' | 'mitigated' | 'accepted' | 'closed';
export const STATUS_BUCKETS: readonly StatusBucket[] = ['open', 'in_treatment', 'mitigated', 'accepted', 'closed'];
export const BUCKET_LABEL: Record<StatusBucket, string> = { open: 'Open', in_treatment: 'In treatment', mitigated: 'Mitigated', accepted: 'Accepted', closed: 'Closed' };

/** `_bucket_status` of the server: any word it does not know is "open", so it is surfaced rather than dropped. */
export function statusBucket(raw: string | null | undefined): StatusBucket {
  const s = (raw || 'open').trim().toLowerCase().replace(/ /g, '_');
  if (['closed', 'resolved', 'cancelled', 'canceled'].includes(s)) return 'closed';
  if (['in_treatment', 'treating', 'under_treatment', 'in_progress', 'under_review', 'mitigating'].includes(s)) return 'in_treatment';
  if (s === 'mitigated') return 'mitigated';
  if (s === 'accepted') return 'accepted';
  return 'open';
}

/** Active = not closed (the dashboard's own word for it: `(status or "open") != "closed"`). */
export const isActive = (r: Pick<RiskRow, 'status'>): boolean => (r.status || 'open') !== 'closed';
export const isFullyScored = (r: Pick<RiskRow, 'inherent_score' | 'residual_score'>): boolean => r.inherent_score != null && r.residual_score != null;
export const isUnscoredActive = (r: RiskRow): boolean => isActive(r) && !isFullyScored(r);
export const isCriticalOpen = (r: RiskRow): boolean => isActive(r) && isFullyScored(r) && (r.residual_score || 0) >= CRITICAL_AT;

// ── category, owner, unit ────────────────────────────────────────────────────────────────────────────────────────────────

export const UNCATEGORISED = 'uncategorised';

/** The category a risk STORES (risk_category, else category): never guessed from its words. Empty is "uncategorised". */
export function categoryKey(r: Pick<RiskRow, 'risk_category' | 'category'>): string {
  const raw = (r.risk_category || r.category || '').trim();
  return raw ? raw.toLowerCase().replace(/[\s-]+/g, '_') : UNCATEGORISED;
}
export function categoryLabel(key: string): string {
  if (key === UNCATEGORISED) return 'Uncategorised';
  const words = key.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Uncategorised';
}

export const NO_OWNER = 'none';
export const NO_UNIT = 'none';
export const NO_FRAMEWORK = 'none';

/** "Mine" = I am the risk owner OR the business owner. */
export const isMine = (r: Pick<RiskRow, 'owner_id' | 'business_owner_id'>, me: number | null | undefined): boolean =>
  me != null && (r.owner_id === me || r.business_owner_id === me);

/** The people of a risk (risk owner, business owner), once each; empty when nobody. */
export function peopleOf(r: Pick<RiskRow, 'owner_id' | 'business_owner_id'>): number[] {
  const ids = [r.owner_id, r.business_owner_id].filter((x): x is number => x != null);
  return ids.filter((id, i) => ids.indexOf(id) === i);
}
export const isUnowned = (r: Pick<RiskRow, 'owner_id' | 'business_owner_id'>): boolean => peopleOf(r).length === 0;

// ── treatment ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Treatment = 'not_started' | 'in_progress' | 'completed';
/** What the risk page derives and never stores: a plan with the risk mitigated is Completed, a plan is In progress, else Not started. */
export function treatmentOf(r: Pick<RiskRow, 'has_plan' | 'status'>): Treatment {
  if (r.has_plan && (r.status || '') === 'mitigated') return 'completed';
  return r.has_plan ? 'in_progress' : 'not_started';
}

// ── appetite and review ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface AppetiteConfig { category?: string | null; max_acceptable_score?: number | null; tolerance_threshold?: number | null }

/** category -> limit, as the dashboard reads it (tolerance, else max acceptable, else 12). Keyed by the category word the config stores. */
export function appetiteLimits(configs: readonly AppetiteConfig[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  (configs ?? []).forEach((c) => {
    if (c.category) out.set(c.category, c.tolerance_threshold || c.max_acceptable_score || 12);
  });
  return out;
}

/** Scored active risks above their category's limit. The server compares on `category` (not risk_category), so this does too. */
export function aboveAppetite(r: RiskRow, limits: ReadonlyMap<string, number>): boolean {
  if (!isActive(r) || !isFullyScored(r)) return false;
  const limit = limits.get(r.category || 'operational');
  return limit != null && (r.residual_score || 0) > limit;
}

/** risk id -> the earliest due date of its open reviews (the pending / in-review reviews the reviews endpoint lists). */
export function reviewIndex(reviews: readonly { risk_id: number; due_date: string }[] | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  (reviews ?? []).forEach((rv) => {
    const cur = out.get(rv.risk_id);
    if (!cur || rv.due_date < cur) out.set(rv.risk_id, rv.due_date);
  });
  return out;
}

export type ReviewState = 'overdue' | 'soon' | 'later' | 'none';
export const REVIEW_SOON_DAYS = 30;
const DAY = 86_400_000;

/** The earliest of the risk's own review date and its open reviews' due dates, and where it stands against `now`. */
export function reviewOf(r: Pick<RiskRow, 'id' | 'review_date'>, reviews: ReadonlyMap<number, string>, now: Date): { state: ReviewState; due: string | null } {
  const dates = [r.review_date, reviews.get(r.id)].filter((d): d is string => !!d).sort();
  const due = dates[0] ?? null;
  if (!due) return { state: 'none', due: null };
  const t = Date.parse(due.length <= 10 ? `${due}T00:00:00Z` : /Z|[+-]\d\d:?\d\d$/.test(due) ? due : `${due}Z`);       // the server's times are naive UTC
  if (Number.isNaN(t)) return { state: 'none', due: null };
  const left = t - now.getTime();
  return { state: left < 0 ? 'overdue' : left <= REVIEW_SOON_DAYS * DAY ? 'soon' : 'later', due };
}

/** Changed in the last 7 days. */
export const RECENT_DAYS = 7;
export function changedRecently(r: Pick<RiskRow, 'updated_at'>, now: Date): boolean {
  if (!r.updated_at) return false;
  const t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(r.updated_at) ? r.updated_at : `${r.updated_at}Z`);
  return !Number.isNaN(t) && now.getTime() - t <= RECENT_DAYS * DAY;
}

// ── the quick views ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const QUICK_IDS = ['all', 'mine', 'review', 'appetite', 'unowned', 'recent', 'unscored', 'critical'] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const QUICK_LABEL: Record<QuickId, string> = {
  all: 'All', mine: 'My risks', review: 'Review overdue', appetite: 'Above appetite', unowned: 'Unowned', recent: 'Recently changed', unscored: 'Not fully scored', critical: 'Critical open',
};

export interface RuleContext {
  me: number | null;
  now: Date;
  limits: ReadonlyMap<string, number>;
  reviews: ReadonlyMap<number, string>;
}

/** Does `r` belong to the quick view? (All: yes.) */
export function inQuick(id: QuickId | null, r: RiskRow, ctx: RuleContext): boolean {
  switch (id) {
    case 'mine': return isMine(r, ctx.me);
    case 'review': return isActive(r) && reviewOf(r, ctx.reviews, ctx.now).state === 'overdue';
    case 'appetite': return aboveAppetite(r, ctx.limits);
    case 'unowned': return isActive(r) && isUnowned(r);
    case 'recent': return changedRecently(r, ctx.now);
    case 'unscored': return isUnscoredActive(r);
    case 'critical': return isCriticalOpen(r);
    default: return true;
  }
}

// ── search and sort ──────────────────────────────────────────────────────────────────────────────────────────────────────

const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words a search looks in: the title (whole), what the risk is filed under and who holds it. Folded (case and accents). */
export function haystack(r: RiskRow, extra: string = ''): string {
  return fold([r.title, r.description_preview, categoryLabel(categoryKey(r)), r.risk_sub_category, r.register_type, r.owner_name, r.business_owner_name, r.business_unit_name, extra]
    .filter(Boolean).join(' '));
}
export const searchTerms = (q: string): string[] => fold(q.trim()).split(/\s+/).filter(Boolean);

export const SORT_KEYS = ['level', 'title', 'inherent', 'residual', 'status', 'owner', 'category', 'review', 'updated', 'created'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';
export interface Sort { key: SortKey; dir: SortDir }
export const DEFAULT_SORT: Sort = { key: 'level', dir: 'desc' };
export const SORT_LABEL: Record<SortKey, string> = {
  level: 'Level', title: 'Title', inherent: 'Inherent score', residual: 'Residual score', status: 'Status', owner: 'Owner', category: 'Category', review: 'Review', updated: 'Last changed', created: 'Created',
};
/** The direction a column starts in when it is chosen. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  level: 'desc', title: 'asc', inherent: 'desc', residual: 'desc', status: 'asc', owner: 'asc', category: 'asc', review: 'asc', updated: 'desc', created: 'desc',
};

/** The next order when `key` is pressed: another column starts in its first direction, the same one flips. */
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
}

const text = (s: string | null | undefined): string => fold(s ?? '');

/** Sorted copy. Equal values keep a stable order (updated, then id) so a page never reshuffles on a re-render; an empty value sorts last in either direction. */
export function sortRisks(rows: readonly RiskRow[], sort: Sort, ctx: { reviews: ReadonlyMap<number, string>; now: Date }): RiskRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (r: RiskRow): string | number | null => {
    switch (sort.key) {
      case 'level': return levelScore(r) || null;
      case 'title': return text(r.title) || null;
      case 'inherent': return r.inherent_score ?? null;
      case 'residual': return r.residual_score ?? null;
      case 'status': return STATUS_BUCKETS.indexOf(statusBucket(r.status));
      case 'owner': return text(r.owner_name || r.business_owner_name) || null;
      case 'category': return text(categoryLabel(categoryKey(r)));
      case 'review': return reviewOf(r, ctx.reviews, ctx.now).due;
      case 'updated': return r.updated_at ?? null;
      default: return r.created_at ?? null;
    }
  };
  return rows.slice().sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    if (x != null && y != null && x !== y) return (x < y ? -1 : 1) * sign;
    const u = (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
    return u !== 0 ? u : b.id - a.id;
  });
}

// ── export ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A cell that a spreadsheet could take for a formula gets an apostrophe in front (=, +, -, @ and the control characters that hide them). */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const EXPORT_HEADERS = ['Title', 'Category', 'Register type', 'Status', 'Level', 'Inherent score', 'Residual score', 'Risk owner', 'Business owner', 'Business unit', 'Priority', 'SLA', 'Review date', 'Frameworks', 'Last changed'] as const;

export function toCsv(rows: readonly RiskRow[], names: { frameworks: (r: RiskRow) => string }): string {
  const lines = rows.map((r) => [
    r.title, categoryLabel(categoryKey(r)), r.register_type ?? '', BUCKET_LABEL[statusBucket(r.status)], levelOf(r) === 'none' ? 'Not scored' : levelOf(r),
    r.inherent_score ?? '', r.residual_score ?? '', r.owner_name ?? '', r.business_owner_name ?? '', r.business_unit_name ?? '', r.effective_priority ?? '',
    r.sla?.state ?? '', r.review_date ?? '', names.frameworks(r), r.updated_at ?? '',
  ].map(csvCell).join(','));
  return [EXPORT_HEADERS.join(','), ...lines].join('\r\n');
}

export const exportName = (date: string, count: number, selection: boolean): string => `risk-register-${date}-${selection ? 'selection-' : ''}${count}.csv`;

// ── the 5x5 matrix ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type Basis = 'inherent' | 'residual';

/** The cell (likelihood, impact) of a risk on a basis, or null when either is missing: what the server's heatmap counts (both greater than 0). */
export function cellOf(r: RiskRow, basis: Basis): { l: number; i: number } | null {
  const l = basis === 'inherent' ? r.inherent_likelihood : r.residual_likelihood;
  const i = basis === 'inherent' ? r.inherent_impact : r.residual_impact;
  return l && i && l > 0 && i > 0 ? { l, i } : null;
}

/** Counts per cell, as `GET /erm/risks/heatmap` gives them: key "l-i" -> count. Only cells with a risk are present. */
export function matrixOf(rows: readonly RiskRow[], basis: Basis): Map<string, number> {
  const out = new Map<string, number>();
  rows.forEach((r) => {
    const c = cellOf(r, basis);
    if (c) out.set(`${c.l}-${c.i}`, (out.get(`${c.l}-${c.i}`) ?? 0) + 1);
  });
  return out;
}

/** The fill of a matrix cell by its level (likelihood x impact), the register's own scale: >= 20 critical ... < 6 low. */
export const cellBand = (l: number, i: number): Band => bandOf(l * i);

// ── saving the form's scores ─────────────────────────────────────────────────────────────────────────────────────────────

/** The four numbers the form's scores come from. */
export interface ScoreInputs { inherent_likelihood?: number | null; inherent_impact?: number | null; residual_likelihood?: number | null; residual_impact?: number | null }
const SCORE_KEYS = ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact'] as const;

/** PUT /erm/risks/{id} has no score fields (it drops them), so an edit that changed a likelihood or an impact is followed by POST /erm/risks/{id}/assess, the route that takes them. A create
 *  sends them with the risk. `original` is what the form was opened with. */
export function scoresToAssess(original: ScoreInputs | null | undefined, sent: ScoreInputs): { inherent_likelihood: number; inherent_impact: number; residual_likelihood?: number; residual_impact?: number } | null {
  if (!original) return null;
  const changed = SCORE_KEYS.some((k) => (sent[k] ?? null) !== (original[k] ?? null));
  if (!changed || !sent.inherent_likelihood || !sent.inherent_impact) return null;
  const body: { inherent_likelihood: number; inherent_impact: number; residual_likelihood?: number; residual_impact?: number } = { inherent_likelihood: sent.inherent_likelihood, inherent_impact: sent.inherent_impact };
  if (sent.residual_likelihood && sent.residual_impact) { body.residual_likelihood = sent.residual_likelihood; body.residual_impact = sent.residual_impact; }
  return body;
}
