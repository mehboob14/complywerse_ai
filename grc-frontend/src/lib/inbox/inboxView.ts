// What the Needs-my-action page decides before it draws anything: its sections and which start open, the ?section= of a link, the pages of 50, the due line, the chips, the line
// of facts under the title and what the whole page says when it has nothing to show. Pure: `node --test src/lib/inbox/inboxView.test.ts`. The numbers come from buildInbox; this
// file only chooses words and views, so a cap here never changes a count.
import { formatCount, formatDate, formatRelative } from '../format.ts';
import { KIND_META, SOURCE_DEFS, type Counts, type Inbox, type InboxItem, type InboxNotice, type Section, type SourceId } from './buildInbox.ts';

/** Rows shown at a time in a section; "Show 50 more" adds the next ones. */
export const PAGE_SIZE = 50;

export type SectionKey = 'decide' | 'ack' | 'sent';
/** `loading`: what a screen reader is told while the section's sources are asked (a sentence of its own: "Loading to decide" is not one) */
export interface SectionSpec { key: SectionKey; section: Section; title: string; empty: string; loading: string }

export const SECTIONS: readonly SectionSpec[] = [
  { key: 'decide', section: 'decision', title: 'To decide', empty: 'Nothing needs your decision.', loading: 'Loading what needs your decision' },
  { key: 'ack', section: 'acknowledgement', title: 'To acknowledge', empty: 'Nothing to acknowledge.', loading: 'Loading the documents to acknowledge' },
  { key: 'sent', section: 'sent', title: 'Sent by me', empty: 'None of the requests you sent is waiting.', loading: 'Loading the requests you sent' },
];

/** The server sends at most 200 of the requests the person sent (the most urgent first) and says how many there are; the page says so, because its number is the true one.
 *  '' when nothing was cut. */
export function sentCutLine(c: Pick<Counts, 'sent' | 'sentTotal'>): string {
  return c.sentTotal > c.sent ? `Showing the ${formatCount(c.sent)} most urgent of ${formatCount(c.sentTotal)} requests you sent.` : '';
}

const ALIAS: Record<string, SectionKey> = {
  decide: 'decide', decision: 'decide', decisions: 'decide', ack: 'ack', acknowledge: 'ack', acknowledgement: 'ack', acknowledgements: 'ack', sent: 'sent',
};

/** ?section=ack|decide|sent (the digest e-mail lands on acknowledgements); anything else is no request. */
export function sectionParam(value: string | null | undefined): SectionKey | null {
  const key = (value ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIAS, key) ? ALIAS[key] : null;
}

/** Which sections start open: the decisions always; the acknowledgements when there is nothing to decide (they are then the page); Sent by me only when asked for.
 *  A section a link asks for is open whatever the rule says. */
export function openByDefault(decisionItems: number, asked: SectionKey | null): Record<SectionKey, boolean> {
  return { decide: true, ack: decisionItems === 0 || asked === 'ack', sent: asked === 'sent' };
}

/** `shown` rows of `items`, the true total, and what the button under them says. */
export function pageOf<T>(items: readonly T[], shown: number) {
  const total = items.length;
  const rows = items.slice(0, Math.max(PAGE_SIZE, shown));
  const next = Math.min(PAGE_SIZE, total - rows.length);
  return {
    rows, total, next,
    summary: next > 0 ? `Showing ${formatCount(rows.length)} of ${formatCount(total)}` : '',
    more: next > 0 ? `Show ${formatCount(next)} more` : '',
  };
}

export type DueTone = 'danger' | 'warning' | 'neutral';

/** The due line of a row: "Overdue by 3 days", "Due today", "Due tomorrow", "Due in 4 days", "Due 12 Nov 2026", "No due date". */
export function dueLine(item: Pick<InboxItem, 'dueAt' | 'overdue'>, now: Date = new Date()): { text: string; tone: DueTone } {
  const rel = item.dueAt ? formatRelative(item.dueAt, now) : '';
  if (!rel) return { text: 'No due date', tone: 'neutral' };
  if (item.overdue) return { text: rel.endsWith(' ago') ? `Overdue by ${rel.slice(0, -4)}` : 'Overdue', tone: 'danger' };
  if (rel === 'today') return { text: 'Due today', tone: 'warning' };
  const days = /^in (\d+) days?$/.exec(rel);
  const n = days ? Number(days[1]) : NaN;
  if (n === 1) return { text: 'Due tomorrow', tone: 'warning' };
  if (n <= 3) return { text: `Due in ${n} days`, tone: 'warning' };
  if (n <= 7) return { text: `Due in ${n} days`, tone: 'neutral' };
  return { text: `Due ${formatDate(item.dueAt)}`, tone: 'neutral' };
}

export type ChipWord = 'escalated' | 'archived' | 'asked_again' | 'can_decide';

/** The words a row carries besides its due line (lib/statuses/inbox.ts): the order they are drawn in. */
export function chipsOf(item: Pick<InboxItem, 'escalation' | 'docStatus' | 'again' | 'counted' | 'section'>): ChipWord[] {
  const chips: ChipWord[] = [];
  if (item.escalation > 0) chips.push('escalated');
  if (item.again) chips.push('asked_again');
  if (item.docStatus === 'archived') chips.push('archived');
  if (item.section === 'decision' && !item.counted) chips.push('can_decide');
  return chips;
}

const SENT_LABEL: Record<string, string> = { review: 'Review requested', approval: 'Approval requested', changes: 'Changes asked for', decide: 'Change proposed', revise: 'Change not accepted' };

/** The line of facts under a row's title: what is asked and of what ("To approve · Standard · v2.1 · asked by Bina Branch"); for a request the person sent, what it is and who it waits for
 *  ("Review requested · Policy · waiting for Rana Reviewer, Rafay Reviewer +1 · 3 pending"). */
export function factsOf(item: InboxItem): string[] {
  const keep = (parts: Array<string | null>) => parts.filter((p): p is string => !!p);
  if (item.section === 'sent' && item.group) {
    const names = item.group.waiting.join(', ');
    const waiting = names ? `waiting for ${names}${item.group.more ? ` +${formatCount(item.group.more)}` : ''}` : null;
    return keep([SENT_LABEL[item.kind] ?? 'Requested', item.context, waiting, `${formatCount(item.group.pending)} pending`]);
  }
  // an acknowledgement sits in the "To acknowledge" section: its kind is said there, so the row says what it is about (the section's name is not repeated 150 times)
  const parts = item.kind === 'acknowledgement'
    ? keep([item.context, item.requester ? `asked by ${item.requester}` : null])
    : keep([`${KIND_META[item.kind].label}${item.again ? ' again' : ''}`, item.context, item.requester ? `asked by ${item.requester}` : null]);
  return parts.length ? parts : [KIND_META[item.kind].label];
}

/** The facts line under the page title: "3 to decide · 1 overdue · 150 to acknowledge"; '' while nothing has been counted. */
export function metaLine(inbox: Inbox): string {
  const c = inbox.counts;
  const parts: string[] = [];
  if (c.decision) parts.push(`${formatCount(c.decision)} to decide`);
  if (c.overdue) parts.push(`${formatCount(c.overdue)} overdue`);
  if (c.canDecide) parts.push(`${formatCount(c.canDecide)} more you can decide`);
  if (c.acknowledgement) parts.push(`${formatCount(c.acknowledgement)} to acknowledge`);
  if (c.sentTotal) parts.push(`${formatCount(c.sentTotal)} sent`);
  return parts.join(' · ');
}

export type PageState = 'loading' | 'unavailable' | 'empty' | 'content';

/** What the whole page is: content as soon as there is anything to list; otherwise still loading, or nothing could be loaded, or all clear. "Nothing needs you" is never
 *  said while a source is loading or has failed. */
export function pageState(inbox: Inbox): PageState {
  if (inbox.items.length > 0) return 'content';
  const states = Object.values(inbox.sources).map((s) => s.state);
  if (states.includes('loading')) return 'loading';
  if (states.includes('unavailable')) return 'unavailable';
  return 'empty';
}

export interface SectionStatus { loading: boolean; notices: InboxNotice[] }

/** Where a section stands: a source that feeds it is still loading, and the notices of the ones that could not be loaded or refreshed. */
export function sectionStatus(inbox: Inbox, section: Section): SectionStatus {
  return {
    loading: (Object.keys(inbox.sources) as SourceId[]).some((id) => inbox.sources[id]?.state === 'loading' && SOURCE_DEFS[id].feeds.includes(section)),
    notices: inbox.notices.filter((n) => n.feeds.includes(section)),
  };
}

/** Whether a section is drawn: the decisions always (it says "Nothing needs your decision" when it is the only thing that is empty); the others only when they hold
 *  something, are loading or have a notice: "hidden only when empty and every source feeding it is ready or off". */
export function sectionVisible(inbox: Inbox, spec: SectionSpec): boolean {
  if (spec.key === 'decide') return true;
  const status = sectionStatus(inbox, spec.section);
  return inbox.bySection[spec.section].length > 0 || status.loading || status.notices.length > 0;
}

/** "from 10:42", the time a stale answer is from, in the viewer's clock. */
export function clockOf(at: number | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
