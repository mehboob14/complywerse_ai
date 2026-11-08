// What a person can do with a unit (one business unit's assessment in one campaign) and what to tell them, apart from React (rules.test.ts). The server's state
// machine is what it is (G8 section 8.2): start from not_started or requires_changes, save and submit from in_progress or requires_changes, approve / reject /
// return from submitted or under_review, and nothing leaves `rejected`. This file only says what the page OFFERS from each state, following the server and never
// widening it; where the page offers less than the server allows, the gap is listed in G9_rcsa_plan.md section 7.

export interface UnitFacts {
  status: string;
  campaignStatus?: string | null;
}

const EDITABLE = ['in_progress', 'requires_changes'];
const IN_REVIEW = ['submitted', 'under_review'];

/** The campaign is running. A draft campaign has no started units and a closed one is finished: the server would still take an answer, the page does not offer it. */
export const campaignRunning = (campaignStatus?: string | null): boolean => (campaignStatus ?? 'active') === 'active';

/** Answers can be typed: the unit is in progress or was sent back, and its campaign is running. */
export const canEdit = (u: UnitFacts): boolean => EDITABLE.includes(u.status) && campaignRunning(u.campaignStatus);

/** The unit has not been opened yet and its campaign is running: the assessor's first visit starts it. */
export const canStart = (u: UnitFacts): boolean => u.status === 'not_started' && campaignRunning(u.campaignStatus);

export const inReview = (status: string): boolean => IN_REVIEW.includes(status);

export type Decision = 'approve' | 'return' | 'reject';

/** The decisions the reviewer is offered: only while the unit waits for review, and only to the people the Worklist counts it as waiting for. */
export function decisions(u: UnitFacts, mayReview: boolean): Decision[] {
  return mayReview && inReview(u.status) ? ['approve', 'return', 'reject'] : [];
}

export interface Step { tier: number; total: number }

/** One plain sentence on where the unit stands and what happens next, for the head of the unit's page. */
export function standing(u: UnitFacts & Partial<Step>, role: 'assessor' | 'reviewer' | 'reader'): string {
  const step = u.total && u.total > 1 ? ` Step ${Math.max(u.tier ?? 1, 1)} of ${u.total}.` : '';
  switch (u.status) {
    case 'not_started': return role === 'assessor' ? 'Not started yet. Opening it starts your assessment.' : 'The assessor has not started yet.';
    case 'in_progress': return role === 'assessor' ? 'Your answers are saved as you go. Submit when the required questions are answered.' : 'The assessor is still answering.';
    case 'requires_changes': return role === 'assessor' ? 'Sent back for changes. Fix the answers the reviewer named, then submit again.' : 'Sent back to the assessor for changes.';
    case 'submitted':
    case 'under_review': return role === 'reviewer' ? `Waiting for your decision.${step}` : `Submitted and waiting for review.${step}`;
    case 'approved': return 'Approved. The answers are final.';
    case 'rejected': return 'Rejected. This unit is closed and cannot be answered again; the risk team decides what happens next.';
    default: return '';
  }
}

/** Why the form is read only, in words, when it is (nothing when it can be edited). */
export function readOnlyReason(u: UnitFacts): string | null {
  if (canEdit(u)) return null;
  if (!campaignRunning(u.campaignStatus)) return u.campaignStatus === 'closed' ? 'This campaign is closed, so the answers can no longer change.' : 'This campaign has not started yet.';
  if (u.status === 'not_started') return 'Not started yet.';
  if (inReview(u.status)) return 'Submitted: the answers are read only while the reviewer decides.';
  if (u.status === 'approved') return 'Approved: the answers are final.';
  if (u.status === 'rejected') return 'Rejected: the answers are closed.';
  return null;
}

/** The submit question. Required questions left empty do not block it (the unit may hand in its part, as the old form allowed) but the person is told how many. */
export function submitAsk(missing: number): { title: string; message: string; confirmLabel: string } {
  if (missing > 0) {
    return {
      title: `Submit with ${missing} required ${missing === 1 ? 'question' : 'questions'} unanswered?`,
      message: 'Your reviewer will see which ones are empty and can send the unit back. Once submitted you cannot change the answers unless it is sent back.',
      confirmLabel: 'Submit anyway',
    };
  }
  return { title: 'Submit for review?', message: 'Every required question is answered. Once submitted you cannot change the answers unless the reviewer sends the unit back.', confirmLabel: 'Submit for review' };
}

/** What the reviewer's comment box asks for. Return and Reject need words (the assessor reads them); Approve does not. */
export function decisionCopy(d: Decision): { title: string; confirm: string; hint: string; required: boolean; tone: 'default' | 'danger' } {
  switch (d) {
    case 'approve': return { title: 'Approve this unit?', confirm: 'Approve', hint: 'Optional note for the record.', required: false, tone: 'default' };
    case 'return': return { title: 'Send back for changes', confirm: 'Send back', hint: 'Say what the assessor must fix. They read this when they open the unit.', required: true, tone: 'default' };
    case 'reject': return { title: 'Reject this unit?', confirm: 'Reject', hint: 'Rejecting closes the unit for good: nobody can answer it again. To ask for changes, send it back instead.', required: true, tone: 'danger' };
  }
}

/** The words the decision's toast says once the server has answered. */
export const decisionDone = (d: Decision, unit: string): string =>
  d === 'approve' ? `Approved ${unit}` : d === 'return' ? `Sent ${unit} back for changes` : `Rejected ${unit}`;
