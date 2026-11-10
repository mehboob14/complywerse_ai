// What the Intake page works out from a request: which switch holds it, the page's state in its address, the question the server is asked (one page of one scope), what a row and the
// selected request say (pills, how long it has waited, the decision, where a possible duplicate leads) and what Approve and create warns about. Pure, so `node --test` runs
// intakeModel.test.ts against it (files under test are imported with .ts). The words of a status are lib/statuses/vendorIntake.ts.
//
// The address (every old link keeps working): ?scope=pending|drafts|approved|declined|all (without it: pending), ?mine=1, ?q=<search>, ?page=<n>, ?open=<id> (the request on the right) and
// ?request=1 (the header's "Request vendor": opens the request dialog once).

import { flag, integer, oneOf, text } from '../../../../lib/addressState.ts';
import { formatDate } from '../../../../lib/format.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import { intakeRequest, intakeScreening, intakeUrgency } from '../../../../lib/statuses/vendorIntake.ts';
import type { Tone } from '../../../../lib/status.ts';
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

export const PAGE_SIZE = 25;

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

/** The server's statuses a switch option holds (All holds every one: null, no filter). */
export function statusesOf(scope: Scope): RequestStatus[] | null {
  return scope === 'all' ? null : (Object.keys(HELD_BY) as RequestStatus[]).filter((s) => HELD_BY[s] === scope);
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

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const INTAKE_SCHEMA = {
  scope: oneOf(SCOPES.map((s) => s.value), 'pending' as Scope),
  mine: flag(),
  q: text(),
  page: integer(1, { min: 1 }),
  open: integer(0, { min: 1 }),
  request: flag(),
};

/** A change of what is listed (a switch, Mine, a search) goes back to page 1 and lets go of the request on the right. */
export const listPatch = (patch: { scope?: Scope; mine?: boolean; q?: string }): { scope?: Scope; mine?: boolean; q?: string; page: number; open: number } => ({ ...patch, page: 1, open: 0 });

/** The question the server is asked: one page of one switch option. The queue (pending) is the server's order; the others are latest change first. */
export function listParams(a: { scope: Scope; mine: boolean; q: string; page: number }): Record<string, string | number | undefined> {
  const statuses = statusesOf(a.scope);
  return {
    scope: a.mine ? 'mine' : 'all',
    search: a.q.trim() || undefined,
    statuses: statuses ? statuses.join(',') : undefined,
    sort: a.scope === 'pending' ? 'queue' : undefined,
    skip: (Math.max(1, a.page) - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
}

/** The last page there is for `total` requests (a link to page 9 of 2 lands on 2). */
export const lastPage = (total: number): number => Math.max(1, Math.ceil(total / PAGE_SIZE));

// ── what a request says ──────────────────────────────────────────────────────────────────────────────────────────────────

const URGENCY_RANK: Record<string, number> = { high: 2, normal: 1, low: 0 };

/** What waits for a decision is a queue: the most urgent first, and among equals the one that has waited longest. Other views
 *  keep the server's order (latest change first). The server sorts a page that way; this orders what a page already holds. */
export function inQueueOrder<T extends { urgency: string; submitted_at: string | null; created_at: string | null }>(rows: T[], scope: Scope): T[] {
  if (scope !== 'pending') return rows;
  const since = (r: T) => parseUtc(r.submitted_at || r.created_at)?.getTime() ?? 0;
  return [...rows].sort((a, b) => (URGENCY_RANK[b.urgency] ?? 1) - (URGENCY_RANK[a.urgency] ?? 1) || since(a) - since(b));
}

export const URGENCY_WORD: Record<string, string> = { low: intakeUrgency.label('low'), normal: intakeUrgency.label('normal'), high: intakeUrgency.label('high') };

export const urgencyPill = (urgency: string | null | undefined): { label: string; tone: Tone } => {
  const word = urgency && intakeUrgency.has(urgency) ? urgency : 'normal';
  return { label: intakeUrgency.label(word), tone: intakeUrgency.tone(word) };
};

export function decisionPill(status: RequestStatus | null | undefined): { label: string; tone: Tone } {
  const word = status && intakeRequest.has(status) ? status : 'draft';
  return { label: intakeRequest.label(word), tone: intakeRequest.tone(word) };
}

/** "Possible duplicate" when it may already be on record, "No duplicate found" when it was checked and is not; nothing once decided. */
export function screeningPill(screening: string | null | undefined): { label: string; tone: Tone } | null {
  return screening === 'flagged' || screening === 'screened' ? { label: intakeScreening.label(screening), tone: intakeScreening.tone(screening) } : null;
}

/** "Approved by Dana Okafor · 5 Mar 2026" under a decided request; null while there is no decision to speak of. */
export function decisionLine(status: RequestStatus | null | undefined, decision: { by: string | null; at: string | null } | null | undefined): string | null {
  if (!decision || (status !== 'in_review' && status !== 'approved' && status !== 'rejected')) return null;
  const verb = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Declined' : 'Picked up';
  return [`${verb} by ${decision.by || 'the review team'}`, decision.at ? formatDate(decision.at) : null].filter(Boolean).join(' · ');
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
  return [row.requested_by?.name || 'Unattributed', row.department, when ? formatDate(when) : null].filter(Boolean).join(' · ');
}

/** How long a request has waited, in the words of a queue: "Today", "1 day", "5 days" (from when it was submitted, else started); null for one with no date. */
export function waited(row: { submitted_at: string | null; created_at: string | null }, now: Date = new Date()): string | null {
  const at = parseUtc(row.submitted_at || row.created_at);
  if (!at || Number.isNaN(at.getTime())) return null;
  const days = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
  return days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
}

/** What is still to do on a draft: "3 answers to go" or "Ready to submit". */
export const draftLine = (openProblems: number): string => (openProblems > 0 ? `${openProblems} ${openProblems === 1 ? 'answer' : 'answers'} to go` : 'Ready to submit');

/** What "Approve and create" says before it goes ahead: what it starts and, when there are matches, which suppliers or requests the new one may duplicate. */
export function approvalNote(name: string, matches: ReadonlyArray<{ name: string }>): string[] {
  const lines = [`${name} joins the vendor register and its lifecycle starts from these answers.`];
  if (matches.length > 0) {
    const shown = matches.slice(0, 3).map((m) => m.name);
    const rest = matches.length - shown.length;
    lines.push(`It may already be on record as ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}. Approving creates a duplicate unless these are different organisations.`);
  }
  return lines;
}

/** The queue's cursor: j / k move through the rows on the page; from nothing, j goes to the first and k to the last; at either end it stays. */
export function stepTo(ids: readonly number[], current: number | null, dir: 1 | -1): number | null {
  if (ids.length === 0) return null;
  const at = current == null ? -1 : ids.indexOf(current);
  if (at < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, at + dir))];
}

/** What an empty list says: nothing at all in this switch option, or nothing that matches the search. */
export function emptyCopy(scope: Scope, searching: boolean): { title: string; hint: string } {
  if (searching) return { title: 'No requests match', hint: 'Try other words, or clear the search.' };
  if (scope === 'pending') return { title: 'No pending requests', hint: 'Requests are screened against the register when they arrive.' };
  return { title: 'No requests here', hint: 'Try another view.' };
}
