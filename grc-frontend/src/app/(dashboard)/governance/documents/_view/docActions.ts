// The one main button a person sees on a document, and the line above the document that says why.

export type PrimaryKind = 'acknowledge' | 'review' | 'approve' | 'publish' | 'submit';

export interface PrimaryInput {
  status: string;
  myAck: boolean;
  myRole: 'reviewer' | 'approver' | null | undefined;
  canEdit: boolean;
  canPublish: boolean;
}

/** First match wins: a personal step (acknowledge, review, approve) beats an admin one (publish, submit). */
export function primaryAction(i: PrimaryInput): { kind: PrimaryKind; label: string } | null {
  if (i.myAck && i.status === 'published') return { kind: 'acknowledge', label: 'Acknowledge' };
  if (i.myRole === 'reviewer') return { kind: 'review', label: 'Review and sign' };
  if (i.myRole === 'approver') return { kind: 'approve', label: 'Approve and sign' };
  if (i.canPublish && i.status === 'approved') return { kind: 'publish', label: 'Publish' };
  if (i.canEdit && i.status === 'draft') return { kind: 'submit', label: 'Submit for review' };
  return null;
}

const LINES: Record<PrimaryKind, string> = {
  acknowledge: 'You are asked to read and acknowledge this document',
  review: 'You are asked to review and sign this document',
  approve: 'You are asked to approve and sign this document',
  publish: 'It is approved: publish it so everyone reads it',
  submit: 'This is a draft: choose reviewers and send it for review',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-30' or '2026-10-30T23:00:00' -> '30 Oct 2026', read from the string so no timezone moves the day. */
function dueText(due: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((due ?? '').trim());
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${day} ${month} ${m[1]}`;
}

export function stepLine(i: { kind: PrimaryKind; due?: string | null }): string {
  const d = dueText(i.due);
  return d ? `${LINES[i.kind]} by ${d}` : LINES[i.kind];
}
