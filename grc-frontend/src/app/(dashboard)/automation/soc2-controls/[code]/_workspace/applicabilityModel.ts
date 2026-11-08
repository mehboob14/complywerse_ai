// Whether a control applies to the organisation, and the request behind it, apart from React so `node --test` pins it (applicabilityModel.test.ts). The server holds the decision on the control's
// state row (scf/router.py): a person with the right to manage frameworks REQUESTS an override with a reason, and a different person with that right rules on it (segregation of duties: the
// reviewer cannot be the one who asked). While a request is pending the row's `is_applicable` holds what was ASKED for, so the page says "asked to mark it not applicable", not "it does not apply".

export interface ApplicabilityBlock {
  is_applicable: boolean | null;
  source: string | null;
  reason: string | null;
  obligation: string | null;
  status: string;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: string | null;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
}

export type ApplicabilityState = 'applies' | 'not_applicable' | 'pending' | 'unscoped';

const SOURCE_WORDS: Readonly<Record<string, string>> = {
  derived: 'Your frameworks decide it.',
  baseline: 'It is part of the baseline you chose.',
  override: 'Your team decided it.',
  inherited: 'Its parent control decides it.',
  gate: 'Your scope rules it out.',
};

export interface ApplicabilityView {
  state: ApplicabilityState;
  /** one sentence about where the control stands */
  headline: string;
  /** why: the reason a person wrote, else what the source means */
  because: string | null;
  /** the request waiting for a ruling, if any */
  pending: { asked: 'applicable' | 'not_applicable'; by: string; at: string | null; reason: string | null; mine: boolean } | null;
  /** the last ruling, when the control's last request was ruled on */
  ruled: { approved: boolean; by: string; at: string | null; comment: string | null } | null;
  canRequest: boolean;
  canDecide: boolean;
  /** why a button is off, in words; null when both are on */
  blocked: string | null;
}

export interface ApplicabilityRights { frameworks: boolean }

/** What the Applicability card and sheet draw. `me` is the signed-in person's id (null while unknown: then nobody is the asker, and the server has the last word). */
export function applicabilityView(a: ApplicabilityBlock | null | undefined, me: number | null, rights: ApplicabilityRights): ApplicabilityView {
  const block = a ?? null;
  const pendingOn = block?.status === 'pending_review';
  const mine = pendingOn && me != null && block?.requested_by === me;
  const asked: 'applicable' | 'not_applicable' = block?.is_applicable === false ? 'not_applicable' : 'applicable';
  const state: ApplicabilityState = pendingOn ? 'pending' : block == null || block.is_applicable == null ? (block?.source ? 'applies' : 'unscoped') : block.is_applicable ? 'applies' : 'not_applicable';
  const because = (block?.reason || '').trim() || (block?.source ? SOURCE_WORDS[block.source] ?? null : null);

  const canRequest = rights.frameworks && !pendingOn;
  const canDecide = rights.frameworks && pendingOn && !mine;
  let blocked: string | null = null;
  if (!rights.frameworks) blocked = 'You need the right to manage frameworks.';
  else if (pendingOn && mine) blocked = 'You asked for this change, so someone else has to decide it.';

  const headline = state === 'pending'
    ? `${block?.requested_by_name || 'Someone'} asked to mark this control ${asked === 'not_applicable' ? 'not applicable' : 'applicable'}.`
    : state === 'not_applicable' ? 'This control does not apply to you.'
      : state === 'applies' ? 'This control applies to you.'
        : 'Your scope has not been calculated yet, so it is not known whether this control applies.';

  const ruledOn = block != null && (block.status === 'approved' || block.status === 'rejected');
  return {
    state,
    headline,
    because,
    pending: pendingOn ? { asked, by: block?.requested_by_name || 'Someone', at: block?.requested_at ?? null, reason: (block?.reason || '').trim() || null, mine } : null,
    ruled: ruledOn ? { approved: block?.status === 'approved', by: block?.reviewed_by_name || 'A reviewer', at: block?.reviewed_at ?? null, comment: (block?.review_comment || '').trim() || null } : null,
    canRequest,
    canDecide,
    blocked,
  };
}

export const REASON_MAX = 2000;

export interface RequestInput { makeApplicable: boolean; reason: string }

/** The server refuses "not applicable" with no reason (400); the page says so before sending. Null when the request can go. */
export function requestProblem(i: RequestInput): string | null {
  const reason = i.reason.trim();
  if (!i.makeApplicable && !reason) return 'Say why this control does not apply. A reviewer reads it before deciding.';
  if (reason.length > REASON_MAX) return `Keep the reason under ${REASON_MAX} characters.`;
  return null;
}

/** The body of POST .../applicability. */
export function requestBody(i: RequestInput): { is_applicable: boolean; reason: string } {
  return { is_applicable: i.makeApplicable, reason: i.reason.trim() };
}

/** The body of POST .../applicability/review. A rejection with no comment is allowed by the server; the page asks for one because the person who asked is waiting for the why. */
export function decisionProblem(approve: boolean, comment: string): string | null {
  return !approve && !comment.trim() ? 'Say why you are refusing, so the person who asked knows what to change.' : null;
}
export const decisionBody = (approve: boolean, comment: string): { approve: boolean; comment: string | null } => ({ approve, comment: comment.trim() || null });
