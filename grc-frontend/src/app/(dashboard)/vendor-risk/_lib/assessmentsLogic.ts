// What the Assessments tab says and decides, apart from React: a card's words, which buttons are blocked and why, the hint
// under the send dialog's questionnaire, the due date as days, and how a reassessment's movement reads.
// Pure, so `node --test "src/app/(dashboard)/vendor-risk/_lib/*.test.ts"` runs assessmentsLogic.test.ts against it.
import type { Tone } from '../_ui/tones.ts';

/** A questionnaire the vendor still owes answers on (the server's WAITING_ON_VENDOR). */
export const WAITING = ['pending', 'in_progress', 'returned'];

export interface CardFacts {
  id: number;
  name: string;
  template_id: number | null;
  status: string;
  expired: boolean;
  active: boolean;
  answered: number;
  questions: number;
  contact: { id: number | null; name: string | null; email: string | null } | null;
}

export interface ScopeFacts {
  tiered: boolean;
  approval_passed: boolean;
  closed: string | null;
}

export interface ContactFacts { email: string | null; portal_access?: boolean; archived_at?: string | null }

const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/** The pill a card wears. The server stores a questionnaire's status as it moves; a link that has run out reads Expired
 *  for as long as the vendor still owes answers. */
export function statusPill(status: string, expired: boolean): { label: string; tone: Tone } {
  if (expired) return { label: 'Expired', tone: 'danger' };
  switch (status) {
    case 'pending': return { label: 'Not started', tone: 'pending' };
    case 'in_progress': return { label: 'In progress', tone: 'progress' };
    case 'returned': return { label: 'Returned', tone: 'warning' };
    case 'submitted': return { label: 'Submitted', tone: 'progress' };
    case 'under_review': return { label: 'In review', tone: 'progress' };
    case 'accepted': return { label: 'Accepted', tone: 'success' };
    default: return { label: sentence(status.replace(/[_-]+/g, ' ')), tone: 'neutral' };
  }
}

/** "Initial · cycle 1", "Reassessment · cycle 2"; a follow-up and one sent with no review say so. */
export function kindLabel(kind: string, cycle: number | null): string {
  const word = kind === 'reassessment' ? 'Reassessment' : kind === 'follow_up' ? 'Follow-up' : kind === 'unlinked' ? 'Not in a review' : 'Initial';
  return cycle != null && kind !== 'unlinked' ? `${word} · cycle ${cycle}` : word;
}

/** Whether a contact can be sent a link: an email, portal access, not archived (the server's contacts.reachable). */
export const reachable = (c: ContactFacts): boolean => !!c.email && c.portal_access !== false && !c.archived_at;

/** Why Send is out of reach, as a sentence for its tooltip; null when it is not. */
export function sendBlocked(scope: ScopeFacts | undefined, contacts: ContactFacts[] | undefined): string | null {
  if (!scope) return 'Loading';
  if (scope.closed) return scope.closed;
  if (!scope.tiered) return 'Tier the engagement first.';
  if (contacts && !contacts.some(reachable)) return 'Add a vendor contact with an email first.';
  return null;
}

/** Why Reassess is out of reach: the next review opens once this one has passed approval. */
export function reassessBlocked(scope: ScopeFacts | undefined): string | null {
  if (!scope) return 'Loading';
  if (scope.closed) return scope.closed;
  if (!scope.approval_passed) return 'Opens once this review has passed approval.';
  return null;
}

/** The questionnaire of this template already out with the vendor in the current review: sending again resends it. */
export function resendTarget(cards: CardFacts[], templateId: number | null): CardFacts | null {
  return cards.find((c) => c.active && WAITING.includes(c.status) && c.template_id === templateId) ?? null;
}

/** The line under the send dialog's questionnaire. Resending keeps the questions; a different questionnaire goes out as well
 *  as the one that is still with the vendor (a tier can call for several, each tracked on its own). */
export function sendHint(args: {
  templateId: number | null;
  cards: CardFacts[];
  tierLabel: string | null;
  isTierDefault: boolean | null;
}): { tone: 'note' | 'warn'; text: string } | null {
  const same = resendTarget(args.cards, args.templateId);
  if (same) {
    return same.answered > 0
      ? { tone: 'warn', text: 'The vendor has started answering. Resending keeps their answers.' }
      : { tone: 'note', text: 'Already sent. Resending keeps these questions.' };
  }
  const other = args.cards.find((c) => c.active && WAITING.includes(c.status));
  if (other) return { tone: 'note', text: `Goes out as well as ${other.name}, which is still with the vendor.` };
  if (args.tierLabel && args.isTierDefault != null) {
    return { tone: 'note', text: `${args.isTierDefault ? 'The default' : 'Not the default'} for ${args.tierLabel} tier vendors.` };
  }
  return null;
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/** Days from today to a date input's "2026-03-25": at least 1, at most a year (what the server takes). */
export function dueInDays(due: string, today: Date = new Date()): number {
  const [y, m, d] = due.split('-').map(Number);
  const days = Math.round((Date.UTC(y, (m || 1) - 1, d || 1) - startOfDay(today)) / DAY);
  return Math.min(365, Math.max(1, days));
}

/** How long the link lives for a due date: the usual 30 days, or a week past the date when that is later. */
export const linkDays = (dueDays: number): number => Math.min(365, Math.max(30, dueDays + 7));

/** An answer's credit as a status tone. */
export function creditTone(credit: string | null): Tone {
  return credit === 'full' ? 'success' : credit === 'partial' ? 'warning' : credit === 'gap' ? 'danger' : 'neutral';
}

export interface Changes {
  residual: { now: number | null; before: number | null; change: number | null };
  grade: { now: string | null; before: string | null };
  moved: number;
  of: number;
  weaker: number;
  stronger: number;
}

/** How the residual moved against the last cycle: the verb and amount, the tone (down is better), the grade when it changed. */
export function movement(ch: Changes): { text: string; verb: string; amount: number | null; tone: Tone; to: number | null; grade: string | null } {
  const { change, now, before } = ch.residual;
  const grade = ch.grade.now && ch.grade.before && ch.grade.now !== ch.grade.before ? `${ch.grade.before} to ${ch.grade.now}` : null;
  if (change == null) {
    return { text: now == null ? 'Score this cycle to compare.' : before == null ? 'The previous cycle was not scored.' : '',
      verb: '', amount: null, tone: 'neutral', to: now, grade };
  }
  const verb = change === 0 ? 'did not move' : change < 0 ? 'fell' : 'rose';
  return { text: '', verb, amount: change === 0 ? null : Math.abs(change), tone: change === 0 ? 'neutral' : change < 0 ? 'success' : 'danger', to: now, grade };
}

/** "6 of 40 answers moved: 2 weaker, 3 stronger." or "No answers changed." */
export function movedLine(ch: Pick<Changes, 'moved' | 'of' | 'weaker' | 'stronger'>): string {
  if (ch.moved === 0) return 'No answers changed.';
  const parts = [ch.weaker ? `${ch.weaker} weaker` : '', ch.stronger ? `${ch.stronger} stronger` : ''].filter(Boolean);
  return `${ch.moved} of ${ch.of} answers moved${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}
