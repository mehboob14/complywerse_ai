// The Tracker layout of the Documents library ("Plain English", design E), without React so `node --test` checks it (libraryTracker.test.ts): where a document stands on the six plain
// steps (Being written > Being checked > Being signed off > Ready to publish > Live > Everyone’s read it), the one-word badge (Live, Needs a fresh look, Out of date, Not live yet, On its
// way ...), ONE short line for what is happening now and ONE for what happens next, and the order of the cards (what needs attention first).
// Real data only: a line names only what the document row or the inbox holds. The row carries the owner, the author, the dates and the acknowledgements (`attestation`); the people a
// request waits for are known only for the requests the signed-in person sent (the inbox's "sent" list) and for the ones addressed to them (its decisions), so a document with neither
// says "Waiting for review", never an invented name. A date is said only when the row has it. The platform's rules win over the sample's: an expired document is "Out of date", a live one
// whose review date has passed is "Needs a fresh look" (the library's own review rule, libraryModel.reviewState), a document is in force while a newer version is written.
import { formatDate } from '../../../../../lib/format.ts';
import { parseUtc } from '../../../../../lib/serverTime.ts';
import type { Tone } from '../../../../../lib/status.ts';
import { KIND_META, type Inbox, type InboxItem, type Kind } from '../../../../../lib/inbox/buildInbox.ts';
import { reviewState, type LibDoc, type Lookups } from './libraryModel.ts';

// ─── The six steps ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type StageId = 'written' | 'checked' | 'signed' | 'ready' | 'live' | 'read';
export interface Stage { id: StageId; name: string; /** the few words said under the step a document is at */ what: string }

export const STAGES: readonly Stage[] = [
  { id: 'written', name: 'Being written', what: 'Someone drafts it' },
  { id: 'checked', name: 'Being checked', what: 'Colleagues read it' },
  { id: 'signed', name: 'Being signed off', what: 'A leader approves' },
  { id: 'ready', name: 'Ready to publish', what: 'Waiting to go live' },
  { id: 'live', name: 'Live', what: 'Everyone follows it' },
  { id: 'read', name: 'Everyone’s read it', what: 'People confirm' },
];
const LIVE = 4;
const READ = 5;

/** done: behind it; here: where it stands; next: still ahead; off: the document is out of the journey (archived, or a status this page does not know). */
export type StepState = 'done' | 'here' | 'next' | 'off';
export interface Step {
  stage: Stage;
  state: StepState;
  /** `here` and it is a problem (out of date, a check-up that is late, an exception): drawn with a warning, not as progress */
  problem: boolean;
  /** what a screen reader and the caption under the step say: "Done", "Now", "Not yet", "Not asked", "Late" ... */
  word: string;
}

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

export interface TrackerContext {
  lookups: Pick<Lookups, 'coverage'>;
  now: Date;
  people?: ReadonlyMap<number, DocPeople>;
}

/** The inbox sources that name documents (the same two the "Waiting for me" chip reads). */
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

// ─── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type BadgeWord = 'Live' | 'Needs a fresh look' | 'Out of date' | 'Not live yet' | 'On its way' | 'Update on its way' | 'Exception applied' | 'Archived';
export interface Badge { word: string; tone: Tone }

/** What each label says, for the "How it works" sheet. */
export const BADGE_MEANING: readonly { word: BadgeWord; meaning: string }[] = [
  { word: 'Live', meaning: 'Published and in force.' },
  { word: 'Needs a fresh look', meaning: 'Live, but its check-up date has passed.' },
  { word: 'Out of date', meaning: 'It has expired and is not in force.' },
  { word: 'Not live yet', meaning: 'A draft. Nobody has to follow it.' },
  { word: 'On its way', meaning: 'Being checked, signed off or waiting to be published.' },
  { word: 'Update on its way', meaning: 'A newer version is being worked on; the one in force still applies.' },
  { word: 'Exception applied', meaning: 'An exception is in place, so it is not in force.' },
  { word: 'Archived', meaning: 'Taken out of use.' },
];

const IN_PROGRESS = ['draft', 'pending_review', 'pending_approval', 'approved', 'review_required'];

/** In force: published, or a newer version is on its way over a published one (the row's `version_in_force`). */
export function isLive(d: Pick<LibDoc, 'status' | 'version_in_force'>): boolean {
  return d.status === 'published' || (IN_PROGRESS.includes(d.status) && !!d.version_in_force);
}

const first = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** The acknowledgements of a document as one object: the row's own, else the coverage map's percentage. null: nobody was asked. */
export function ackOf(d: Pick<TrackerDoc, 'id' | 'attestation'>, lk: Pick<Lookups, 'coverage'>): { pct: number; done: number | null; total: number | null } | null {
  const a = d.attestation;
  if (a && Number.isFinite(a.pct)) return { pct: Math.max(0, Math.min(100, Math.round(a.pct))), done: Number.isFinite(a.done) ? a.done : null, total: Number.isFinite(a.total) ? a.total : null };
  const pct = lk.coverage[d.id];
  return pct == null || !Number.isFinite(pct) ? null : { pct: Math.max(0, Math.min(100, Math.round(pct))), done: null, total: null };
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

/** How long ago, in words: "today", "yesterday", "6 days ago", "3 months ago". '' when there is no date. */
export function agoWords(iso: string | null | undefined, now: Date): string {
  const at = parseUtc(iso);
  if (!at) return '';
  const n = Math.max(0, utcDay(now) - utcDay(at));
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 60) return `${n} days ago`;
  if (n < 730) return `${Math.round(n / 30.44)} months ago`;
  return `${Math.round(n / 365)} years ago`;
}

const dayOf = (iso: string | null | undefined): string => formatDate(iso, { calendar: true, empty: '' });
const version = (v: string): string => `v${v.replace(/^v/i, '')}`;

// ─── Where a document stands ─────────────────────────────────────────────────────────────────────────────────────────────

export interface Standing {
  badge: Badge;
  /** the index of the step it is at; null: out of the journey (archived, an unknown status) */
  at: number | null;
  /** the last step is finished too (everyone has read it) */
  complete: boolean;
  /** the step it is at is a problem */
  problem: boolean;
  live: boolean;
  /** overdue, due soon ... of its review date (libraryModel.reviewState) */
  review: ReturnType<typeof reviewState>;
  ack: ReturnType<typeof ackOf>;
}

export function standingOf(d: TrackerDoc, ctx: Pick<TrackerContext, 'lookups' | 'now'>): Standing {
  const review = reviewState(d, ctx.now);
  const ack = ackOf(d, ctx.lookups);
  const live = isLive(d);
  const late = live && review.bucket === 'overdue';
  const base = { live, review, ack, complete: false, problem: false };
  switch (d.status) {
    case 'archived': return { ...base, badge: { word: 'Archived', tone: 'neutral' }, at: null };
    case 'expired': return { ...base, badge: { word: 'Out of date', tone: 'danger' }, at: LIVE, problem: true };
    case 'exception_applied': return { ...base, badge: { word: 'Exception applied', tone: 'warning' }, at: LIVE, problem: true };
    case 'published': {
      const at = ack ? READ : LIVE;
      const complete = !!ack && ack.pct >= 100;
      return { ...base, at, complete, problem: late, badge: late ? { word: 'Needs a fresh look', tone: 'warning' } : { word: 'Live', tone: 'success' } };
    }
    case 'draft': case 'pending_review': case 'pending_approval': case 'approved': case 'review_required': {
      let at = d.status === 'draft' ? 0 : d.status === 'pending_review' ? 1 : d.status === 'pending_approval' ? 2 : d.status === 'approved' ? 3 : 1;
      if (d.status === 'review_required' && live) at = LIVE;
      const badge: Badge = late ? { word: 'Needs a fresh look', tone: 'warning' }
        : live ? { word: 'Update on its way', tone: 'progress' }
        : d.status === 'draft' ? { word: 'Not live yet', tone: 'neutral' }
        : { word: 'On its way', tone: 'progress' };
      return { ...base, badge, at, problem: d.status === 'review_required' && live };
    }
    default: return { ...base, badge: { word: d.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), tone: 'neutral' }, at: null };
  }
}

/** The six steps with their state; `narrow` is not here: the view decides what to show, the words are the same. */
export function stepsOf(s: Standing): Step[] {
  return STAGES.map((stage, i): Step => {
    if (s.at === null) return { stage, state: 'off', problem: false, word: 'Not in use' };
    if (s.complete) return { stage, state: 'done', problem: false, word: 'Done' };
    if (i < s.at) return { stage, state: 'done', problem: false, word: 'Done' };
    if (i === s.at) {
      const word = s.problem ? (s.badge.word === 'Needs a fresh look' ? 'Check-up late' : s.badge.word === 'Out of date' ? 'Expired' : s.badge.word === 'Exception applied' ? 'Exception' : 'Needs a look') : i === READ ? 'Under way' : 'Now';
      return { stage, state: 'here', problem: s.problem, word };
    }
    return { stage, state: 'next', problem: false, word: i === READ && s.live && !s.ack ? 'Not asked' : 'Not yet' };
  });
}

// ─── Now and Next ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What waits for the person themselves, in the words of the inbox's own kinds. */
const WAITING_FOR_YOU: Partial<Record<Kind, string>> = {
  approval: 'Waiting for your sign-off.', signoff: 'Waiting for your sign-off.', review: 'Waiting for your review.',
  decide: 'A change is waiting for your decision.', revise: 'Waiting for you to revise it.', changes: 'Waiting for you to make the changes asked for.',
};

export interface Lines { now: string; next: string }

export function linesOf(d: TrackerDoc, s: Standing, ctx: Pick<TrackerContext, 'now' | 'people'>): Lines {
  const people = ctx.people?.get(d.id);
  const owner = first(d.owner_name);
  const author = first(d.author_name) ?? owner;
  const reviewDay = dayOf(d.next_review_date);
  const checkUp = reviewDay ? `Next check-up is ${reviewDay}.` : 'No check-up date is set.';
  const stays = d.version_in_force && d.version_in_force !== d.current_version ? ` ${version(d.version_in_force)} is still in force.` : '';
  const mineWords = people?.mine ? WAITING_FOR_YOU[people.mine.kind] : undefined;
  const sent = people?.sent && (people.sent.waiting.length > 0 || people.sent.more > 0) ? nameList(people.sent.waiting, people.sent.more) : '';

  switch (d.status) {
    case 'draft':
      return {
        now: `${author ? `${author} is writing it.` : 'Still being written.'}${stays || ' Nobody has to follow it yet.'}`,
        next: 'When it is finished, colleagues check it.',
      };
    case 'pending_review':
      return {
        now: `${mineWords ?? (sent ? `Waiting for review from ${sent}.` : 'Waiting for review.')}${stays}`,
        next: 'Then an approver decides whether to sign it off.',
      };
    case 'pending_approval':
      return {
        now: `${mineWords ?? (sent ? `Waiting for ${sent} to sign off.` : 'Waiting for sign-off.')}${stays}`,
        next: 'Once signed off, it waits to be published.',
      };
    case 'approved': {
      const when = agoWords(d.approved_at, ctx.now);
      return { now: `${when ? `Signed off ${when}.` : 'Signed off.'} Not published yet.${stays}`, next: 'Publishing makes it live for everyone it applies to.' };
    }
    case 'review_required':
      return {
        now: s.live ? 'Flagged for a fresh review. The version in force still applies.' : `Flagged for review.${stays}`,
        next: 'Once reviewed, an approver decides whether to sign it off.',
      };
    case 'published': {
      if (s.review.bucket === 'overdue') {
        const late = s.review.long.replace(/^Overdue by /, '');
        return {
          now: s.review.long === 'Overdue today' || !reviewDay ? 'Live, but its check-up is due today.' : `Live, but its check-up was due ${reviewDay}, ${late} ago.`,
          next: owner ? `${owner} needs to confirm it is still correct.` : 'It has no owner. Someone needs to take it on.',
        };
      }
      const a = s.ack;
      if (a && a.pct < 100) {
        const left = a.total != null && a.done != null ? Math.max(0, a.total - a.done) : null;
        return {
          now: left != null && a.total != null
            ? `Live. ${left} of ${a.total} ${a.total === 1 ? 'person' : 'people'} still ${left === 1 ? 'has' : 'have'} to confirm they have read it.`
            : `Live. ${100 - a.pct}% still have to confirm they have read it.`,
          next: checkUp,
        };
      }
      if (a) return { now: 'Live. Everyone has confirmed they have read it.', next: reviewDay ? `Nothing until the next check-up on ${reviewDay}.` : checkUp };
      return { now: 'Live. Nobody has been asked to confirm they have read it.', next: reviewDay ? `Nothing until the next check-up on ${reviewDay}.` : checkUp };
    }
    case 'expired': {
      const ran = dayOf(d.expiry_date);
      return {
        now: ran ? `It ran out on ${ran} and is not in force.` : 'It has run out and is not in force.',
        next: owner ? `${owner} needs to publish a new version.` : 'It has no owner to replace it.',
      };
    }
    case 'exception_applied':
      return { now: 'An exception applies, so it is not in force.', next: 'A new version has to be published for it to be in force again.' };
    case 'archived':
      return { now: 'Taken out of use. Nobody has to follow it.', next: 'It can be restored as a draft.' };
    default:
      return { now: '', next: '' };
  }
}

// ─── One card ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Track extends Standing, Lines {
  steps: Step[];
  /** the signed-in person has something to do on it */
  you: { word: 'Needs you' | 'You’re late'; what: string } | null;
  /** "Step 2 of 6: Being checked": the one line a narrow card says instead of the step names */
  where: string;
}

export function trackOf(d: TrackerDoc, ctx: TrackerContext): Track {
  const s = standingOf(d, ctx);
  const steps = stepsOf(s);
  const m = ctx.people?.get(d.id)?.mine;
  const you = m ? { word: m.overdue ? ('You’re late' as const) : ('Needs you' as const), what: KIND_META[m.kind].action } : null;
  const where = s.at === null ? 'Not in use' : s.complete ? 'All 6 steps done' : `Step ${s.at + 1} of 6: ${STAGES[s.at].name}`;
  return { ...s, ...linesOf(d, s, ctx), steps, you, where };
}

// ─── The order of the cards: what needs attention first ──────────────────────────────────────────────────────────────────

/** Lower is sooner. Yours first (late ones before the rest), then what lapsed, what is live but late for its check-up, an exception, live documents still waiting for people to read
 *  them, what is on its way, drafts, live documents with nothing wrong, archived. */
export function attentionOf(d: TrackerDoc, ctx: TrackerContext): { rank: number; tail: number } {
  const m = ctx.people?.get(d.id)?.mine;
  if (m) return { rank: 0, tail: m.overdue ? 0 : 1 };
  switch (d.status) {
    case 'expired': return { rank: 1, tail: 0 };
    case 'exception_applied': return { rank: 3, tail: 0 };
    case 'archived': return { rank: 8, tail: 0 };
    case 'published': case 'draft': case 'pending_review': case 'pending_approval': case 'approved': case 'review_required': {
      const r = reviewState(d, ctx.now);
      if (isLive(d) && r.bucket === 'overdue') return { rank: 2, tail: r.days ?? 0 };          // the longest late first
      if (d.status === 'published') {
        const a = ackOf(d, ctx.lookups);
        return a && a.pct < 100 ? { rank: 4, tail: a.pct } : { rank: 7, tail: 0 };                // the least read first
      }
      return { rank: d.status === 'draft' ? 6 : 5, tail: 0 };
    }
    default: return { rank: 8, tail: 1 };
  }
}

/** The documents in the order of the cards. A stable sort: documents of the same standing keep the order they came in (the order the person chose for the list). */
export function trackerOrder<D extends TrackerDoc>(docs: readonly D[], ctx: TrackerContext): D[] {
  const keyed = docs.map((d, i) => ({ d, i, ...attentionOf(d, ctx) }));
  keyed.sort((a, b) => a.rank - b.rank || a.tail - b.tail || a.i - b.i);
  return keyed.map((k) => k.d);
}

/** How many cards are drawn before "Show more", and how many each press adds. */
export const CARDS_AT_A_TIME = 12;
export const cardsShown = (shown: number, total: number): { count: number; more: number } => {
  const count = Math.min(Math.max(CARDS_AT_A_TIME, shown), total);
  return { count, more: Math.min(CARDS_AT_A_TIME, total - count) };
};
