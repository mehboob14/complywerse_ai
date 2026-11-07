// What the Risk Reviews page decides, apart from React so `node --test` pins it (reviewsModel.test.ts): where a review stands (overdue is worked out here: the server never writes "overdue"),
// the filters and their TRUE counts over the complete list, the order, and what completing a review sends: the risk's new likelihood and impact WITH their scores (the server trusts the
// scores it is sent and does not recompute them, so a review that sent only the likelihood and impact left the risk's score as it was), and the review's own new scores, findings and
// recommendations. The words of the review's status are the ones the page writes: pending -> in_review (Start) -> completed (Complete).

export interface Review {
  id: number;
  risk_id: number;
  risk_title?: string | null;
  review_cycle?: string | null;
  review_type?: string | null;
  status: string;
  due_date: string;
  started_at?: string | null;
  completed_at?: string | null;
  reviewer_id?: number | null;
  findings?: string | null;
  recommendations?: string | null;
  new_inherent_score?: number | null;
  new_residual_score?: number | null;
}

export type ReviewFilter = 'all' | 'pending' | 'in_review' | 'overdue' | 'completed';
export const FILTERS: readonly ReviewFilter[] = ['all', 'pending', 'in_review', 'overdue', 'completed'];
export const FILTER_LABEL: Record<ReviewFilter, string> = { all: 'All', pending: 'Pending', in_review: 'In review', overdue: 'Overdue', completed: 'Completed' };

const utc = (s: string): number => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.length <= 10 ? `${s}T00:00:00Z` : `${s}Z`);

/** A review that is not finished and whose due date has passed. */
export function isOverdue(r: Pick<Review, 'status' | 'due_date'>, now: Date): boolean {
  const open = r.status === 'pending' || r.status === 'in_review';
  const t = utc(r.due_date);
  return open && !Number.isNaN(t) && t < now.getTime();
}

/** Days late (1 or more) for an overdue review, else 0. */
export function daysLate(r: Pick<Review, 'status' | 'due_date'>, now: Date): number {
  return isOverdue(r, now) ? Math.max(1, Math.floor((now.getTime() - utc(r.due_date)) / 86_400_000)) : 0;
}

export function matchesFilter(r: Review, f: ReviewFilter, now: Date): boolean {
  switch (f) {
    case 'pending': return r.status === 'pending';
    case 'in_review': return r.status === 'in_review';
    case 'overdue': return isOverdue(r, now);
    case 'completed': return r.status === 'completed' || r.status === 'approved';
    default: return true;
  }
}

/** The true number behind each filter, over the complete list. */
export function countsOf(list: readonly Review[], now: Date): Record<ReviewFilter, number> {
  const out = { all: list.length, pending: 0, in_review: 0, overdue: 0, completed: 0 };
  list.forEach((r) => { (['pending', 'in_review', 'overdue', 'completed'] as const).forEach((f) => { if (matchesFilter(r, f, now)) out[f] += 1; }); });
  return out;
}

export type SortKey = 'due' | 'risk' | 'status';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'due', dir: 'asc' };

const STATUS_RANK: Record<string, number> = { in_review: 0, pending: 1, completed: 2, approved: 2, rejected: 3, skipped: 4 };

/** Sorted copy; equal values keep a fixed order (due date, then id) so a page never reshuffles. Search: the risk's title. */
export function sortReviews(list: readonly Review[], sort: Sort): Review[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const key = (r: Review): string | number => (sort.key === 'risk' ? (r.risk_title || '').toLowerCase() : sort.key === 'status' ? STATUS_RANK[r.status] ?? 9 : utc(r.due_date));
  return list.slice().sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x !== y) return (x < y ? -1 : 1) * sign;
    return utc(a.due_date) - utc(b.due_date) || a.id - b.id;
  });
}

export const matchesSearch = (r: Review, q: string): boolean => { const t = q.trim().toLowerCase(); return !t || (r.risk_title || '').toLowerCase().includes(t); };

// ── completing a review ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface CompleteInput {
  risk: { inherent_likelihood?: number | null; inherent_impact?: number | null; residual_likelihood?: number | null; residual_impact?: number | null } | undefined;
  inhL: string; inhI: string; resL: string; resI: string;
  findings: string; recommendations: string;
}

const num = (s: string): number | undefined => (s === '' ? undefined : Number(s));

/** What completing sends. The risk is updated only where a likelihood or impact changed, and then with BOTH scores of the pair it belongs to (likelihood x impact); the review is written
 *  completed with the new scores (when both of a pair are given) and its words. A pair with one half missing has no score. */
export function completeBody(i: CompleteInput): { riskUpdate: Record<string, number>; review: Record<string, unknown> } {
  const inhL = num(i.inhL); const inhI = num(i.inhI); const resL = num(i.resL); const resI = num(i.resI);
  const was = i.risk;
  const riskUpdate: Record<string, number> = {};
  if (inhL !== undefined && inhL !== was?.inherent_likelihood) riskUpdate.inherent_likelihood = inhL;
  if (inhI !== undefined && inhI !== was?.inherent_impact) riskUpdate.inherent_impact = inhI;
  if (resL !== undefined && resL !== was?.residual_likelihood) riskUpdate.residual_likelihood = resL;
  if (resI !== undefined && resI !== was?.residual_impact) riskUpdate.residual_impact = resI;
  const inherentScore = inhL !== undefined && inhI !== undefined ? inhL * inhI : undefined;
  const residualScore = resL !== undefined && resI !== undefined ? resL * resI : undefined;
  if (('inherent_likelihood' in riskUpdate || 'inherent_impact' in riskUpdate) && inherentScore !== undefined) riskUpdate.inherent_score = inherentScore;
  if (('residual_likelihood' in riskUpdate || 'residual_impact' in riskUpdate) && residualScore !== undefined) riskUpdate.residual_score = residualScore;
  return {
    riskUpdate,
    review: {
      status: 'completed', new_inherent_score: inherentScore, new_residual_score: residualScore,
      findings: i.findings.trim() || undefined, recommendations: i.recommendations.trim() || undefined,
    },
  };
}

/** What the person is told is wrong with a draft ("" = fine): a likelihood is 1 to 5 and comes with its impact. */
export function completeProblem(i: Pick<CompleteInput, 'inhL' | 'inhI' | 'resL' | 'resI'>): string {
  const bad = (s: string) => s !== '' && !(Number.isInteger(Number(s)) && Number(s) >= 1 && Number(s) <= 5);
  if ([i.inhL, i.inhI, i.resL, i.resI].some(bad)) return 'A likelihood or an impact is a whole number from 1 to 5.';
  if ((i.inhL === '') !== (i.inhI === '')) return 'Give both the inherent likelihood and impact, or neither.';
  if ((i.resL === '') !== (i.resI === '')) return 'Give both the residual likelihood and impact, or neither.';
  return '';
}
