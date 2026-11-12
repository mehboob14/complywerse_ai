export interface ReviewLike { status: string; due_date: string; completed_at?: string | null }

/** A review as GET /erm/reviews returns it, with the proposal a second person approves. */
export interface ReviewRow extends ReviewLike {
  id: number;
  risk_id: number;
  risk_title?: string | null;
  review_cycle: string;
  review_type: string;
  started_at?: string | null;
  reviewer_id?: number | null;
  approver_id?: number | null;
  submitted_by?: number | null;
  findings?: string | null;
  recommendations?: string | null;
  approval_notes?: string | null;
  previous_inherent_score?: number | null;
  previous_residual_score?: number | null;
  new_inherent_score?: number | null;
  new_residual_score?: number | null;
  proposed_inherent_likelihood?: number | null;
  proposed_inherent_impact?: number | null;
  proposed_residual_likelihood?: number | null;
  proposed_residual_impact?: number | null;
}

/** Scheduled ("pending" on the server) or in review: the reviewer still owns it. */
export const WORKING = ['pending', 'scheduled', 'in_review'];
export const DONE = ['approved', 'completed', 'rejected'];

/** Scheduled or in review and past its due date. A submitted review waits on the approver instead. */
export const isReviewOverdue = (r: ReviewLike, now: Date): boolean =>
  WORKING.includes(r.status) && new Date(r.due_date) < now;

export type ReviewTab = 'due' | 'overdue' | 'awaiting' | 'upcoming' | 'completed';

/** The page tab a review sits on; null for a status no tab lists (e.g. skipped). */
export function reviewTab(r: ReviewLike, now: Date): ReviewTab | null {
  if (r.status === 'submitted') return 'awaiting';
  if (DONE.includes(r.status)) return 'completed';
  if (!WORKING.includes(r.status)) return null;
  if (isReviewOverdue(r, now)) return 'overdue';
  const due = new Date(r.due_date);
  return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() ? 'due' : 'upcoming';
}

export interface ScoreRow { label: string; before: number | null; after: number | null; delta: number | null }

export const scoreRow = (label: string, before?: number | null, after?: number | null): ScoreRow => ({
  label, before: before ?? null, after: after ?? null,
  delta: before != null && after != null ? after - before : null,
});

type Side = 'inherent' | 'residual';
export type RiskScores = Partial<Record<`${Side}_${'likelihood' | 'impact' | 'score'}`, number | null>>;
const SIDES: Array<[Side, string]> = [['inherent', 'Before controls'], ['residual', 'After controls']];

/** The risk's last approved values beside the review's proposal; a value not proposed stays as it is. */
export function compareScores(risk: RiskScores, review: Partial<ReviewRow>): ScoreRow[] {
  return SIDES.flatMap(([side, name]) => {
    const l = review[`proposed_${side}_likelihood`] ?? risk[`${side}_likelihood`];
    const i = review[`proposed_${side}_impact`] ?? risk[`${side}_impact`];
    const proposedLI = review[`proposed_${side}_likelihood`] != null || review[`proposed_${side}_impact`] != null;
    // The old API proposed a bare score; otherwise the score is likelihood x impact.
    const score = proposedLI ? (l && i ? l * i : null) : review[`new_${side}_score`] ?? risk[`${side}_score`];
    return [
      scoreRow(`${name}: likelihood`, risk[`${side}_likelihood`], l),
      scoreRow(`${name}: impact`, risk[`${side}_impact`], i),
      scoreRow(`${name}: score`, risk[`${side}_score`], score),
    ];
  });
}

/** What an approved review changed: the scores before and after it. */
export const approvedScores = (r: Partial<ReviewRow>): ScoreRow[] => [
  scoreRow('Before controls: score', r.previous_inherent_score, r.new_inherent_score),
  scoreRow('After controls: score', r.previous_residual_score, r.new_residual_score),
];
