// The "Needs you" strip of the Documents library ("Plain English", design E: "Things you need to do"): the signed-in person's own tasks on documents, read from the inbox the top bar and
// Needs my action already ask for, without React so `node --test` checks it (libraryNeedsYou.test.ts). It computes nothing the inbox does not: the items are the ones the shared model
// (components/overview/workList.ts, workOf) lists for the two document sources, in its order with the late ones first; this file only says each in plain words: a verb and the title,
// one plain status word (Late, Needs you), one hint (the due line of the Needs-my-action page, else who sent it and when).
import { formatRelative } from '../../../../../lib/format.ts';
import type { InboxItem, Kind } from '../../../../../lib/inbox/buildInbox.ts';
import { dueLine } from '../../../../../lib/inbox/inboxView.ts';
import { itemsFor, lengthOf, type Work } from '../../../../../components/overview/workList.ts';
import { DOCUMENT_SOURCES } from './libraryTracker.ts';

export { DOCUMENT_SOURCES as NEEDS_YOU_SOURCES };

/** How many tasks the strip lists before "See all". */
export const NEEDS_YOU_LIMIT = 5;

/** What the person is asked to do, in the plain words of the sample ("Read and confirm", "Check and comment on"). */
export const PLAIN_VERB: Record<Kind, string> = {
  approval: 'Sign off', signoff: 'Sign off', review: 'Check and comment on', decide: 'Decide on a change to', revise: 'Revise', changes: 'Make the changes to',
  acknowledgement: 'Read and confirm', evidence: 'Check the evidence for',
};

export type NeedsYouWord = 'Late' | 'Needs you';

export interface NeedsYouRow {
  key: string;
  /** "Read and confirm: Acceptable use policy" */
  title: string;
  word: NeedsYouWord;
  late: boolean;
  /** "Due in 5 days", "Overdue by 3 days", "Bina Branch sent this to you 6 days ago" */
  hint: string;
  href: string;
}

/** "Sent to you today / yesterday / 6 days ago", with the sender's name when the inbox has it. */
export function sentHint(item: Pick<InboxItem, 'createdAt' | 'requester'>, now: Date): string {
  const rel = item.createdAt ? formatRelative(item.createdAt, now) : '';
  const when = !rel ? '' : rel === '1 day ago' ? 'yesterday' : rel.startsWith('in ') ? 'today' : rel;
  if (!when) return item.requester ? `Sent to you by ${item.requester}` : '';
  return item.requester ? `${item.requester} sent this to you ${when}` : `Sent to you ${when}`;
}

export function rowOf(item: InboxItem, now: Date): NeedsYouRow {
  const hint = item.dueAt ? dueLine(item, now).text : sentHint(item, now);
  return {
    key: item.key,
    title: `${PLAIN_VERB[item.kind]}: ${item.title}`,
    word: item.overdue ? 'Late' : 'Needs you',
    late: item.overdue,
    hint,
    href: item.href,
  };
}

export interface NeedsYou {
  rows: NeedsYouRow[];
  /** every task, not only the ones listed */
  total: number;
  late: number;
  cut: boolean;
}

/** The strip: the first `limit` of the person's tasks (the late ones first, then the inbox's own order), the true total and how many are late. */
export function needsYou(work: Work, now: Date, limit: number = NEEDS_YOU_LIMIT): NeedsYou {
  const all = itemsFor(work, 'all');
  const ordered = [...all.filter((i) => i.overdue), ...all.filter((i) => !i.overdue)];
  const page = lengthOf(ordered, limit);
  return { rows: page.rows.map((i) => rowOf(i, now)), total: page.total, late: work.counts.overdue, cut: page.cut };
}
