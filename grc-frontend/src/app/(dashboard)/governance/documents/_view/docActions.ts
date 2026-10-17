// The one main button a person sees on a document, and the line above the document that says why.

export type PrimaryKind = 'acknowledge' | 'review' | 'approve' | 'publish' | 'submit';

export interface PrimaryInput {
  status: string;
  myAck: boolean;
  myRole: 'reviewer' | 'approver' | null | undefined;
  canEdit: boolean;
  canPublish: boolean;
  /** a version of it is in force (published, or published before while a new version is on its way): it can be acknowledged */
  inForce?: boolean;
}

/** First match wins: a personal step (acknowledge, review, approve) beats an admin one (publish, submit). */
export function primaryAction(i: PrimaryInput): { kind: PrimaryKind; label: string } | null {
  if (i.myAck && (i.inForce || i.status === 'published')) return { kind: 'acknowledge', label: 'Acknowledge' };
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

const ON_ITS_WAY: Record<string, string> = { draft: 'being revised', pending_review: 'in review', pending_approval: 'awaiting approval', approved: 'approved' };

/** The line above a document while a new version of it is on its way and the published one stays in force; null otherwise.
 *  `newer` (the server sends it to someone who reads the version in force): they read the published one; without it, the person
 *  reads the newest (`current`) and everyone else the published one. */
export function inForceLine(d: { status: string; current: string; inForce?: string | null; newer?: { number: string; status: string } | null }): string | null {
  if (d.newer) {
    const when = d.newer.status === 'approved' ? 'when it is published' : 'when it is approved and published';
    return `You are reading the published version v${d.current}. Version ${d.newer.number} is ${ON_ITS_WAY[d.newer.status] ?? d.newer.status.replace(/_/g, ' ')}; it replaces this one ${when}.`;
  }
  if (!d.inForce || d.inForce === d.current || !ON_ITS_WAY[d.status]) return null;
  return `This is version ${d.current} (${ON_ITS_WAY[d.status]}). Everyone else reads the published version v${d.inForce} until this one is published.`;
}

/** What Publish does to acknowledgements: a major version (1.0, 2.0) asks everyone, a minor one (1.1) only the people who have not
 *  acknowledged this major version yet (backend: doc_lifecycle.request_acknowledgements). */
export function publishLine(version: string, lifecycle: boolean): string {
  if (!lifecycle) return 'It becomes the version everyone reads.';
  const [major, minor] = version.trim().replace(/^v/i, '').split('.');
  return Number(minor || 0) === 0
    ? 'It becomes the version everyone reads, and every active user is asked to read and acknowledge it.'
    : `It becomes the version everyone reads. People who have not acknowledged a version ${major}.x yet are asked to read and acknowledge it; those who have are not asked again.`;
}

type Obligation = { id: number; kind: string; status: string; user_id: number; version: string | null; requested_at: string | null; done_at: string | null };

const newestDone = <T extends Obligation>(rows: T[]): T | undefined =>
  [...rows].sort((a, b) => ((a.done_at ?? '') < (b.done_at ?? '') ? 1 : (a.done_at ?? '') > (b.done_at ?? '') ? -1 : b.id - a.id))[0];

/** A draft sent back: its newest rejection, unless a reviewer or approver was asked again after it. Null for any other status. */
export function rejectionOf<T extends Obligation>(status: string, rows: T[]): T | null {
  if (status !== 'draft') return null;
  const signing = rows.filter((r) => r.kind === 'review' || r.kind === 'approval');
  const last = newestDone(signing.filter((r) => r.status === 'rejected'));
  if (!last) return null;
  return signing.some((r) => (r.requested_at ?? '') > (last.done_at ?? '')) ? null : last;
}

/** The version this person last acknowledged, when it is not `current` (the version they are asked about now); else null. */
export function lastAcknowledged(rows: Obligation[], me: number | null | undefined, current: string): string | null {
  const v = newestDone(rows.filter((r) => r.user_id === me && r.kind === 'acknowledgement' && r.status === 'done' && r.version))?.version ?? null;
  return v && v !== current ? v : null;
}
