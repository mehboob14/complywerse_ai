// The Tracker layout of the Documents library, without React so `node --test` checks it (libraryTracker.test.ts): the documents sorted into GROUPS that follow the life cycle the platform
// really runs (Draft > In review > In approval > Approved > Published, then the groups for what needs attention: Changes requested, Changes proposed, Review overdue, Expired, Exception
// applied, Archived), the count of each and the ONE line that says what holds it up ("4 late, 1 stuck"), and the paging that keeps a library of thousands cheap (groups closed, rows 25 at a time).
// Every document is in exactly ONE group, so the counts add up to the documents shown: what needs attention takes a document out of its step's group (an archived, expired or excepted
// document, one sent back for changes, one with a proposed change waiting for its owner, a published one whose review date has passed), in that order.
// Real data only: the lean rows give the status, the dates, the owner and the attestation; the server's sets (GET /governance/document-tracker/sets: who is stuck, held, late, sent back,
// waiting for a proposed change) give the rest. A set that is missing (not loaded yet, or refused) says nothing: a figure is never invented from it, and a document is then in its step's group.
// The compact line of a document is lineModel.ts, the detail of a document detailModel.ts; the words a person reads about the steps are glossary.ts.
import { formatDate } from '../../../../../lib/format.ts';
import { parseUtc } from '../../../../../lib/serverTime.ts';
import type { Tone } from '../../../../../lib/status.ts';
import type { Inbox, InboxItem, Kind } from '../../../../../lib/inbox/buildInbox.ts';
import { NO_SETS, type SetKey } from '../../../../../lib/documentTrackerApi.ts';
import { reviewState, type LibDoc, type Lookups } from './libraryModel.ts';

// ─── The documents these rules read ──────────────────────────────────────────────────────────────────────────────────────

export interface TrackerDoc extends LibDoc {
  review_cycle_months?: number | null;
  approved_at?: string | null;
  published_at?: string | null;
  /** a lean row carries the acknowledgements of the document's campaign; null: no campaign */
  attestation?: { pct: number; done: number; total: number } | null;
}

/** What the inbox says about one document for this person. */
export interface DocPeople {
  /** this person's own open request on it (a decision first, then an acknowledgement) */
  mine?: { kind: Kind; overdue: boolean; dueAt: string | null; requester: string | null; createdAt: string | null };
  /** the people the signed-in person asked, who have not answered: the first names, and how many more */
  sent?: { waiting: string[]; more: number; overdue: boolean };
}

/** The server's sets as the rules read them (NO_SETS: none known). */
export type Sets = Readonly<Record<SetKey, ReadonlySet<number>>>;
export const setsOf = (answer: Partial<Record<SetKey, readonly number[]>> | null | undefined): Sets => {
  if (!answer) return NO_SETS;
  const out = { ...NO_SETS } as Record<SetKey, ReadonlySet<number>>;
  for (const k of Object.keys(NO_SETS) as SetKey[]) out[k] = new Set(Array.isArray(answer[k]) ? (answer[k] as readonly number[]) : []);
  return out;
};

export interface TrackerContext {
  lookups: Pick<Lookups, 'coverage'> & Partial<Pick<Lookups, 'departments' | 'departmentPaths' | 'frameworks'>>;
  now: Date;
  people?: ReadonlyMap<number, DocPeople>;
  /** which documents are stuck, held, late ...; without it a document is in its step's group and no figure about them is said */
  sets?: Sets;
}

/** The inbox sources that name documents (the same two the "Waiting for me" filter reads). */
export const DOCUMENT_SOURCES = ['doc.lifecycle', 'doc.signoff'] as const;

/** The inbox as it concerns each document: the person's own requests (decisions before acknowledgements, the inbox's own order) and, when the sent list was asked for, who the
 *  requests they sent wait for. Nothing is worked out that the inbox does not say. */
export function peopleOf(inbox: Pick<Inbox, 'bySection'>): Map<number, DocPeople> {
  const out = new Map<number, DocPeople>();
  const of = (id: number): DocPeople => { let p = out.get(id); if (!p) { p = {}; out.set(id, p); } return p; };
  const mine: InboxItem[] = [...inbox.bySection.decision, ...inbox.bySection.acknowledgement];
  for (const item of mine) {
    if (item.documentId == null || !(DOCUMENT_SOURCES as readonly string[]).includes(item.source)) continue;
    const p = of(item.documentId);
    if (!p.mine) p.mine = { kind: item.kind, overdue: item.overdue, dueAt: item.dueAt, requester: item.requester, createdAt: item.createdAt };
  }
  for (const item of inbox.bySection.sent) {
    if (item.documentId == null || !item.group) continue;
    const p = of(item.documentId);
    const names = (p.sent?.waiting ?? []).slice();
    for (const n of item.group.waiting) if (!names.includes(n)) names.push(n);
    p.sent = { waiting: names, more: (p.sent?.more ?? 0) + item.group.more, overdue: !!p.sent?.overdue || item.overdue };
  }
  return out;
}

// ─── Words and dates ─────────────────────────────────────────────────────────────────────────────────────────────────────

const IN_PROGRESS = ['draft', 'pending_review', 'pending_approval', 'approved', 'review_required'];

/** Published, or a newer version is on its way over a published one (the row's `version_in_force`). */
export function isLive(d: Pick<LibDoc, 'status' | 'version_in_force'>): boolean {
  return d.status === 'published' || (IN_PROGRESS.includes(d.status) && !!d.version_in_force);
}

/** "A", "A and B", "A, B and C", "A, B and 2 more". */
export function nameList(names: readonly string[], more = 0): string {
  const all = [...names];
  if (more > 0) all.push(`${more} more`);
  if (all.length <= 1) return all[0] ?? '';
  return `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
}

const DAY = 86_400_000;
const utcDay = (d: Date) => Math.floor(d.getTime() / DAY);

/** Whole UTC calendar days from `iso` to `now` (never negative); null without a date. */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  const at = parseUtc(iso);
  return at ? Math.max(0, utcDay(now) - utcDay(at)) : null;
}

/** "today", "1 day", "6 days", "3 months", "2 years". */
export function spanWords(days: number): string {
  if (days <= 0) return 'today';
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${Math.round(days / 365)} years`;
}

/** "today", "yesterday", "6 days ago", "3 months ago". '' when there is no date. */
export function agoWords(iso: string | null | undefined, now: Date): string {
  const n = daysSince(iso, now);
  if (n === null) return '';
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${spanWords(n)} ago`;
}

/** The short age in a pill: "today", "4 d", "3 mo". */
export function ageLabel(days: number): string {
  return days <= 0 ? 'today' : days < 60 ? `${days} d` : days < 730 ? `${Math.round(days / 30.44)} mo` : `${Math.round(days / 365)} y`;
}

export const dayOf = (iso: string | null | undefined): string => formatDate(iso, { calendar: true, empty: '' });

/** The age pill's tone: nothing to worry about, a week or more, two weeks or more (or late). */
export const ageTone = (days: number, late = false): Tone => (late || days >= 14 ? 'danger' : days >= 7 ? 'warning' : 'neutral');

// ─── The attestation of a document ───────────────────────────────────────────────────────────────────────────────────────

export type AttestationState = 'none' | 'not_started' | 'in_progress' | 'complete';
export interface Attestation { state: AttestationState; done: number | null; total: number | null; pct: number | null }

/** Where a document's attestation stands, in the Board's own words: none requested | requested but nobody has acknowledged | started | everyone has. The row's own numbers, else the
 *  coverage map's percentage. */
export function attestationOf(d: Pick<TrackerDoc, 'id' | 'attestation'>, lk: Pick<Lookups, 'coverage'>): Attestation {
  const a = d.attestation;
  const pct = a && Number.isFinite(a.pct) ? a.pct : lk.coverage[d.id];
  if (pct == null || !Number.isFinite(pct)) return { state: 'none', done: null, total: null, pct: null };
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const done = a && Number.isFinite(a.done) ? a.done : null;
  const total = a && Number.isFinite(a.total) ? a.total : null;
  const state: AttestationState = (done !== null && total !== null ? done >= total && total > 0 : p >= 100) ? 'complete' : (done !== null ? done === 0 : p === 0) ? 'not_started' : 'in_progress';
  return { state, done, total, pct: p };
}

// ─── The groups ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type GroupId = 'draft' | 'review' | 'approval' | 'approved' | 'published' | 'changes' | 'proposed' | 'overdue' | 'expired' | 'exception' | 'archived' | 'other';
export interface GroupDef {
  id: GroupId;
  /** one to three words */
  label: string;
  kind: 'step' | 'attention';
  /** the tone of its mark: attention groups are drawn with a colour besides the word */
  tone: Tone;
  /** the (i) note: what being in this group means */
  info: string;
}

export const GROUPS: readonly GroupDef[] = [
  { id: 'draft', label: 'Draft', kind: 'step', tone: 'neutral', info: 'Being written. Nobody has to follow it yet.' },
  { id: 'review', label: 'In review', kind: 'step', tone: 'progress', info: 'Reviewers read it and sign, or ask for changes.' },
  { id: 'approval', label: 'In approval', kind: 'step', tone: 'progress', info: 'Approvers decide. Nothing is published without this step.' },
  { id: 'approved', label: 'Approved', kind: 'step', tone: 'success', info: 'Signed off and waiting to be published. Nobody has to follow it yet.' },
  { id: 'published', label: 'Published', kind: 'step', tone: 'success', info: 'The version everyone follows. Attestation and acknowledgement happen here.' },
  { id: 'changes', label: 'Changes requested', kind: 'attention', tone: 'warning', info: 'A reviewer or approver sent it back. It waits until the author makes the changes and resubmits it.' },
  { id: 'proposed', label: 'Changes proposed', kind: 'attention', tone: 'warning', info: 'Someone who is not the owner proposed a change. It waits until the owner accepts or rejects it.' },
  { id: 'overdue', label: 'Review overdue', kind: 'attention', tone: 'danger', info: 'Published, but its review date has passed, or a fresh review was asked for.' },
  { id: 'expired', label: 'Expired', kind: 'attention', tone: 'danger', info: 'Its end date has passed. It no longer applies.' },
  { id: 'exception', label: 'Exception applied', kind: 'attention', tone: 'warning', info: 'An exception is in place, so it is not enforced.' },
  { id: 'archived', label: 'Archived', kind: 'attention', tone: 'neutral', info: 'Taken out of use.' },
  { id: 'other', label: 'Other', kind: 'attention', tone: 'neutral', info: 'A status this page does not know.' },
];
export const GROUP_BY_ID: Readonly<Record<GroupId, GroupDef>> = Object.fromEntries(GROUPS.map((g) => [g.id, g])) as Record<GroupId, GroupDef>;

/** The group a document is in: what needs attention first (archived, expired, an exception, sent back for changes, a proposed change waiting, a review that is late), else its step. */
export function groupOf(d: TrackerDoc, ctx: Pick<TrackerContext, 'now' | 'sets'>): GroupId {
  const sets = ctx.sets ?? NO_SETS;
  switch (d.status) {
    case 'archived': return 'archived';
    case 'expired': return 'expired';
    case 'exception_applied': return 'exception';
    default: break;
  }
  if (sets.changes_requested.has(d.id)) return 'changes';
  if (sets.proposals_waiting.has(d.id)) return 'proposed';
  switch (d.status) {
    case 'published': return reviewState(d, ctx.now).bucket === 'overdue' ? 'overdue' : 'published';
    case 'review_required': return isLive(d) ? 'overdue' : 'review';
    case 'draft': return 'draft';
    case 'pending_review': return 'review';
    case 'pending_approval': return 'approval';
    case 'approved': return 'approved';
    default: return 'other';
  }
}

export interface Group<D extends TrackerDoc = TrackerDoc> {
  def: GroupDef;
  docs: D[];
  count: number;
  /** the one line that says what holds it up ("4 late, 1 stuck"); '' when nothing does */
  summary: string;
  /** how many of its documents wait for the signed-in person */
  mine: number;
}

const mineRank = (d: TrackerDoc, ctx: Pick<TrackerContext, 'people'>): number => {
  const m = ctx.people?.get(d.id)?.mine;
  return m ? (m.overdue ? 0 : 1) : 2;
};

/** The documents in their groups, in the order of GROUPS; a group with nothing in it is not there. Inside a group the person's own (late ones first) come first, then the order the
 *  documents came in (the order the person chose for the list). */
export function buildGroups<D extends TrackerDoc>(docs: readonly D[], ctx: TrackerContext): Group<D>[] {
  const by = new Map<GroupId, D[]>();
  for (const d of docs) {
    const id = groupOf(d, ctx);
    const list = by.get(id);
    if (list) list.push(d); else by.set(id, [d]);
  }
  const out: Group<D>[] = [];
  for (const def of GROUPS) {
    const list = by.get(def.id);
    if (!list) continue;
    const keyed = list.map((d, i) => ({ d, i, r: mineRank(d, ctx) })).sort((a, b) => a.r - b.r || a.i - b.i).map((k) => k.d);
    out.push({ def, docs: keyed, count: keyed.length, summary: summaryOf(def.id, keyed, ctx), mine: keyed.filter((d) => ctx.people?.get(d.id)?.mine).length });
  }
  return out;
}

// ─── The one line under a group ──────────────────────────────────────────────────────────────────────────────────────────

const piece = (n: number, text: string): string => (n > 0 ? `${n} ${text}` : '');
const MONTH = 30;
const WEEK = 7;

/** What holds the group's documents up, in a few words and only with figures that are known: "4 late, 1 stuck, 2 wait for you". '' when nothing does. */
export function summaryOf(id: GroupId, docs: readonly TrackerDoc[], ctx: TrackerContext): string {
  const sets = ctx.sets ?? NO_SETS;
  const count = (test: (d: TrackerDoc) => boolean) => docs.reduce((n, d) => n + (test(d) ? 1 : 0), 0);
  const you = piece(count((d) => !!ctx.people?.get(d.id)?.mine), 'for you');
  const parts: string[] = [];
  switch (id) {
    case 'draft':
      parts.push(piece(count((d) => d.owner_id == null), 'with no owner'));
      parts.push(piece(count((d) => (daysSince(d.updated_at, ctx.now) ?? 0) >= MONTH), `not touched for ${MONTH} days`));
      parts.push(piece(count((d) => !!d.version_in_force), 'updating a published one'));
      break;
    case 'review': case 'approval': {
      const late = count((d) => sets.late_approvals.has(d.id));
      parts.push(piece(late, 'late'));
      parts.push(piece(count((d) => sets.stuck.has(d.id) && !sets.late_approvals.has(d.id)), 'stuck'));
      parts.push(piece(count((d) => sets.waiting_week.has(d.id) && !sets.late_approvals.has(d.id) && !sets.stuck.has(d.id)), 'waiting over a week'));   // late and stuck are already said
      break;
    }
    case 'approved': {
      const old = count((d) => (daysSince(d.approved_at, ctx.now) ?? 0) >= WEEK);
      parts.push(piece(old, 'waiting over a week to be published'));
      break;
    }
    case 'published': {
      const states = docs.map((d) => attestationOf(d, ctx.lookups).state);
      parts.push(piece(states.filter((s) => s === 'not_started').length, 'attestations not started'));
      parts.push(piece(states.filter((s) => s === 'in_progress').length, 'attestations under way'));
      parts.push(piece(count((d) => sets.late_acknowledgements.has(d.id)), 'with late acknowledgements'));
      parts.push(piece(count((d) => d.owner_id == null), 'with no owner'));
      break;
    }
    case 'changes': parts.push('waiting for the author to revise and resubmit'); break;
    case 'proposed': parts.push('waiting for the owner to accept or reject'); break;
    case 'overdue': {
      const longest = docs.reduce((m, d) => Math.max(m, -(reviewState(d, ctx.now).days ?? 0)), 0);
      parts.push(longest > 0 ? `longest ${spanWords(longest)} late` : '');
      parts.push(piece(count((d) => d.owner_id == null), 'with no owner'));
      break;
    }
    case 'expired': parts.push('no longer apply'); parts.push(piece(count((d) => d.owner_id == null), 'with no owner')); break;
    case 'exception': parts.push('not enforced while an exception is in place'); break;
    case 'archived': parts.push('taken out of use'); break;
    default: break;
  }
  parts.push(you);
  return parts.filter(Boolean).join(', ');
}

// ─── Paging: a library may hold thousands ────────────────────────────────────────────────────────────────────────────────

/** How many rows a group draws before "Show more", and how many each press adds. */
export const ROWS_AT_A_TIME = 25;
export const rowsShown = (shown: number, total: number): { count: number; more: number } => {
  const count = Math.min(Math.max(ROWS_AT_A_TIME, shown), total);
  return { count, more: Math.min(ROWS_AT_A_TIME, total - count) };
};
/** The rows in pages of ROWS_AT_A_TIME: a page asks the server for its own lines, so opening a group costs one request, and "Show more" one more. */
export function pagesOf<T>(items: readonly T[], upTo: number, size: number = ROWS_AT_A_TIME): T[][] {
  const out: T[][] = [];
  const end = Math.min(items.length, Math.max(size, upTo));
  for (let i = 0; i < end; i += size) out.push(items.slice(i, Math.min(end, i + size)));
  return out;
}
