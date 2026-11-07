// What the risk page decides, apart from React so `node --test` pins it (riskPageModel.test.ts): the risk reduction, the in-place assessment edit (what is sent, what is refused), the
// owner words, and the History feed built from what the server returns (reviews, score history, mitigation actions, incidents): nothing is invented, every line is a row somebody wrote.
import { bandOf, type Band } from '../../_register/riskModel.ts';

/** `round((inherent - residual) / inherent x 100)`, only when both scores exist (the page's own rule since the first version). */
export function riskReduction(inherent: number | null | undefined, residual: number | null | undefined): number | null {
  if (!inherent || !residual) return null;
  return Math.round(((inherent - residual) / inherent) * 100);
}

// ── the assessment, edited in place ──────────────────────────────────────────────────────────────────────────────────────

export interface Assessment {
  status: string;
  priority: string;            // '' = from the score
  ownerId: string;             // '' = nobody
  businessOwnerId: string;
  inherentL: string; inherentI: string; residualL: string; residualI: string;     // '' = not scored
}

export interface RiskForAssessment {
  status?: string | null; priority?: string | null; owner_id?: number | null; business_owner_id?: number | null;
  inherent_likelihood?: number | null; inherent_impact?: number | null; residual_likelihood?: number | null; residual_impact?: number | null;
}

const str = (n: number | null | undefined): string => (n == null ? '' : String(n));

export function assessmentOf(r: RiskForAssessment): Assessment {
  return {
    status: r.status || 'open', priority: r.priority || '', ownerId: str(r.owner_id), businessOwnerId: str(r.business_owner_id),
    inherentL: str(r.inherent_likelihood), inherentI: str(r.inherent_impact), residualL: str(r.residual_likelihood), residualI: str(r.residual_impact),
  };
}

export const sameAssessment = (a: Assessment, b: Assessment): boolean => (Object.keys(a) as (keyof Assessment)[]).every((k) => a[k] === b[k]);

/** What is wrong with a draft, in words ("" = nothing). A pair is both or neither; the residual pair needs the inherent pair; and a score that is set cannot be cleared (the server's
 *  assess route has no way to unset one). */
export function assessmentProblem(a: Assessment, was?: Assessment): string {
  const half = (l: string, i: string) => (l === '') !== (i === '');
  if (half(a.inherentL, a.inherentI)) return 'Choose both a likelihood and an impact for the inherent score.';
  if (half(a.residualL, a.residualI)) return 'Choose both a likelihood and an impact for the residual score.';
  if (was && ((was.inherentL !== '' && a.inherentL === '') || (was.residualL !== '' && a.residualL === ''))) return 'A score that is set cannot be cleared here. Choose a new one.';
  if (a.residualL !== '' && a.inherentL === '') return 'Give the inherent score before the residual score.';
  return '';
}

/** The fields PUT /erm/risks/{id} takes (it has no score fields): only what changed. A priority of '' is "from the score". */
export function fieldsPatch(was: Assessment, now: Assessment): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (now.status !== was.status) out.status = now.status;
  if (now.priority !== was.priority) out.priority = now.priority;
  if (now.ownerId !== was.ownerId) out.owner_id = now.ownerId === '' ? null : Number(now.ownerId);
  if (now.businessOwnerId !== was.businessOwnerId) out.business_owner_id = now.businessOwnerId === '' ? null : Number(now.businessOwnerId);
  return out;
}

/** The body of POST /erm/risks/{id}/assess when a likelihood or an impact changed, else null. The server works the scores out (likelihood x impact); the residual pair travels with it only
 *  when it is complete. */
export function assessBody(was: Assessment, now: Assessment): { inherent_likelihood: number; inherent_impact: number; residual_likelihood?: number; residual_impact?: number } | null {
  const changed = (['inherentL', 'inherentI', 'residualL', 'residualI'] as const).some((k) => now[k] !== was[k]);
  if (!changed || now.inherentL === '' || now.inherentI === '') return null;
  const body: { inherent_likelihood: number; inherent_impact: number; residual_likelihood?: number; residual_impact?: number } = { inherent_likelihood: Number(now.inherentL), inherent_impact: Number(now.inherentI) };
  if (now.residualL !== '' && now.residualI !== '') { body.residual_likelihood = Number(now.residualL); body.residual_impact = Number(now.residualI); }
  return body;
}

const pair = (l: string, i: string): { likelihood: number | null; impact: number | null; score: number | null } =>
  l === '' || i === '' ? { likelihood: null, impact: null, score: null } : { likelihood: Number(l), impact: Number(i), score: Number(l) * Number(i) };

/** The two scores a draft would give. */
export function draftScores(a: Assessment): { inherent: number | null; residual: number | null; band: Band } {
  const inherent = pair(a.inherentL, a.inherentI).score;
  const residual = pair(a.residualL, a.residualI).score;
  return { inherent, residual, band: bandOf(residual || inherent) };
}

// ── History ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HistoryInput {
  reviews?: readonly { id: number; status: string; review_type?: string; due_date: string; started_at?: string | null; completed_at?: string | null; reviewer_id?: number | null; new_residual_score?: number | null; findings?: string | null }[];
  scores?: readonly { id: number; recorded_at: string; inherent_score?: number | null; residual_score?: number | null; status?: string | null; change_reason?: string | null; changed_by?: number | null }[];
  actions?: readonly { id: number; title: string; status: string; created_at: string; completed_at?: string | null; owner_name?: string | null; due_date?: string | null }[];
  incidents?: readonly { id: number; title: string; severity?: string | null; status?: string | null; incident_date: string }[];
  created?: string | null;
}

export type HistoryKind = 'score' | 'review' | 'action' | 'incident' | 'created';
export interface HistoryItem { key: string; at: string; kind: HistoryKind; title: string; detail?: string }

const words = (s: string | null | undefined): string => (s ? s.replace(/_/g, ' ') : '');
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const n = (x: number | null | undefined): string => (x == null ? 'not scored' : String(Math.round(x)));

/** Newest first. A score row says what the scores were then and why it was recorded; a review says it was scheduled, started or completed (one line each, at the time each happened);
 *  an action says it was added and, when it has, completed; an incident is dated by when it happened. The risk's own creation is the last line. Equal times keep the order given. */
export function historyFeed(input: HistoryInput): HistoryItem[] {
  const items: HistoryItem[] = [];
  (input.scores ?? []).forEach((s) => items.push({
    key: `score-${s.id}`, at: s.recorded_at, kind: 'score', title: `Scores recorded: inherent ${n(s.inherent_score)}, residual ${n(s.residual_score)}`,
    detail: [s.change_reason, s.status ? `Status ${words(s.status)}` : ''].filter(Boolean).join(' · ') || undefined,
  }));
  (input.reviews ?? []).forEach((r) => {
    const kind = cap(words(r.review_type) || 'review');
    items.push({ key: `review-${r.id}-due`, at: r.due_date, kind: 'review', title: `${kind} review ${r.completed_at ? 'was due' : 'is due'}`, detail: cap(words(r.status)) });
    if (r.started_at) items.push({ key: `review-${r.id}-start`, at: r.started_at, kind: 'review', title: `${kind} review started` });
    if (r.completed_at) {
      items.push({
        key: `review-${r.id}-done`, at: r.completed_at, kind: 'review', title: `${kind} review ${r.status === 'rejected' ? 'rejected' : 'completed'}`,
        detail: [r.new_residual_score != null ? `New residual score ${n(r.new_residual_score)}` : '', r.findings || ''].filter(Boolean).join(' · ') || undefined,
      });
    }
  });
  (input.actions ?? []).forEach((a) => {
    items.push({ key: `action-${a.id}-new`, at: a.created_at, kind: 'action', title: `Mitigation action added: ${a.title}`, detail: a.owner_name ? `Owner ${a.owner_name}` : undefined });
    if (a.completed_at) items.push({ key: `action-${a.id}-done`, at: a.completed_at, kind: 'action', title: `Mitigation action completed: ${a.title}` });
  });
  (input.incidents ?? []).forEach((i) => items.push({
    key: `incident-${i.id}`, at: i.incident_date, kind: 'incident', title: `Incident: ${i.title}`, detail: [i.severity ? cap(i.severity) : '', i.status ? cap(words(i.status)) : ''].filter(Boolean).join(' · ') || undefined,
  }));
  if (input.created) items.push({ key: 'created', at: input.created, kind: 'created', title: 'Risk added to the register' });
  return items.map((it, i) => ({ it, i })).sort((a, b) => (a.it.at < b.it.at ? 1 : a.it.at > b.it.at ? -1 : a.i - b.i)).map((x) => x.it);
}
