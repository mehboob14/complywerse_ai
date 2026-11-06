// What the Intake page works out from a request: which switch holds it, what its pills say, the line about its decision, where a
// possible duplicate leads. Pure, so `node --test` runs intakeModel.test.ts against it (the kit's own files are imported with .ts).

import { parseUtc } from '../../../../lib/serverTime.ts';
import { fmt } from '../_ui/fmt.ts';
import { tones, type Tone } from '../_ui/tones.ts';
import type { RequestStatus } from './intake/types.ts';

export type Scope = 'pending' | 'drafts' | 'approved' | 'declined' | 'all';

/** The switch, in order: what waits for a decision, what is still being written, then how decided ones ended. */
export const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'all', label: 'All' },
];

// Pending is what waits for the review team. "Approve and create" decides a request: from then on it is a supplier going through
// its lifecycle, so it sits with the approved ones (still marked In review until the lifecycle's approval gate has decided it).
const HELD_BY: Record<RequestStatus, Exclude<Scope, 'all'>> = {
  draft: 'drafts', submitted: 'pending', in_review: 'approved', approved: 'approved', rejected: 'declined',
};

/** The scope named in the address; anything else is the first one. */
export function asScope(value: string | null | undefined): Scope {
  return SCOPES.some((s) => s.value === value) ? (value as Scope) : 'pending';
}

export function inScope(status: RequestStatus | null | undefined, scope: Scope): boolean {
  return scope === 'all' || (!!status && HELD_BY[status] === scope);
}

/** How many requests each switch option holds, from the server's count per status. */
export function scopeCounts(counts: Partial<Record<RequestStatus, number>> | undefined): Record<Scope, number> {
  const out: Record<Scope, number> = { pending: 0, drafts: 0, approved: 0, declined: 0, all: 0 };
  for (const [status, n] of Object.entries(counts ?? {})) {
    const held = HELD_BY[status as RequestStatus];
    if (held) out[held] += n ?? 0;
    out.all += n ?? 0;
  }
  return out;
}

const URGENCY_RANK: Record<string, number> = { high: 2, normal: 1, low: 0 };

/** What waits for a decision is a queue: the most urgent first, and among equals the one that has waited longest. Other views
 *  keep the server's order (latest change first). */
export function inQueueOrder<T extends { urgency: string; submitted_at: string | null; created_at: string | null }>(rows: T[], scope: Scope): T[] {
  if (scope !== 'pending') return rows;
  const since = (r: T) => parseUtc(r.submitted_at || r.created_at)?.getTime() ?? 0;
  return [...rows].sort((a, b) => (URGENCY_RANK[b.urgency] ?? 1) - (URGENCY_RANK[a.urgency] ?? 1) || since(a) - since(b));
}

export const URGENCY_WORD: Record<string, string> = { low: 'Low urgency', normal: 'Normal urgency', high: 'High urgency' };

export function decisionPill(status: RequestStatus | null | undefined): { label: string; tone: Tone } {
  switch (status) {
    case 'submitted': return { label: 'Awaiting decision', tone: tones.decision('submitted') };
    case 'in_review': return { label: 'In review', tone: tones.decision('in_review') };
    case 'approved': return { label: 'Approved', tone: tones.decision('approved') };
    case 'rejected': return { label: 'Declined', tone: tones.decision('rejected') };
    default: return { label: 'Draft', tone: tones.decision('draft') };
  }
}

/** "Flagged" when it may already be on record, "Screened" when it was checked and is not; nothing once decided. */
export function screeningPill(screening: string | null | undefined): { label: string; tone: Tone } | null {
  if (screening === 'flagged') return { label: 'Flagged', tone: tones.screening('flagged') };
  if (screening === 'screened') return { label: 'Screened', tone: tones.screening('passed') };
  return null;
}

/** "Approved by Dana Okafor · 5 Mar 2026" under a decided request; null while there is no decision to speak of. */
export function decisionLine(status: RequestStatus | null | undefined, decision: { by: string | null; at: string | null } | null | undefined): string | null {
  if (!decision || (status !== 'in_review' && status !== 'approved' && status !== 'rejected')) return null;
  const verb = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Declined' : 'Picked up';
  return [`${verb} by ${decision.by || 'the review team'}`, decision.at ? fmt.date(decision.at) : null].filter(Boolean).join(' · ');
}

/** A request is not a supplier yet until it is picked up: a match that is still a request opens as one. */
export function matchHref(m: { id: number; intake_status: string | null }): string {
  return m.intake_status === 'draft' || m.intake_status === 'submitted' || m.intake_status === 'rejected'
    ? `/vendor-risk/intake/${m.id}` : `/vendor-risk/vendors/${m.id}`;
}

export function matchNote(m: { archived: boolean; intake_status: string | null }): string {
  if (m.archived) return ' (archived)';
  return m.intake_status === 'draft' || m.intake_status === 'submitted' ? ' (a request)' : m.intake_status === 'rejected' ? ' (declined request)' : '';
}

/** "Dana Okafor · Growth · 5 Mar 2026": who asked, for which department, when. */
export function byline(row: { requested_by: { name: string | null } | null; department: string | null; submitted_at: string | null; created_at: string | null }): string {
  const when = row.submitted_at || row.created_at;
  return [row.requested_by?.name || 'Unattributed', row.department, when ? fmt.date(when) : null].filter(Boolean).join(' · ');
}
