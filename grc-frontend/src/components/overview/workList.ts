// "Needs my action" on an Overview, apart from React so `node --test` can pin it (workList.test.ts): the shared inbox (lib/inbox/buildInbox.ts, the model
// the top bar's badge and the Needs-my-action page use) narrowed to the sources one module owns, the rules of its filter and its length, and each item as
// the props of the kit's WorkRow. It computes nothing the inbox does not: an item is in the list because buildInbox put it there, in the order buildInbox
// gave it (decisions first, then acknowledgements), so this list, the page and the badge cannot disagree.
import { KIND_META, type Inbox, type InboxItem, type InboxNotice, type Kind, type SourceId } from '../../lib/inbox/buildInbox.ts';
import { chipsOf } from '../../lib/inbox/inboxView.ts';
import { inboxChip } from '../../lib/statuses/inbox.ts';
import type { Tone } from '../../lib/status.ts';

export type WorkState = 'loading' | 'unavailable' | 'empty' | 'content';

export interface Work {
  state: WorkState;
  /** the decisions: reviews, approvals, sign-offs, changes asked for, proposed changes */
  decide: InboxItem[];
  /** the documents to read and acknowledge */
  acknowledge: InboxItem[];
  /** the sources of this module that could not be loaded (or refreshed), with the server's words */
  notices: InboxNotice[];
  counts: { decide: number; acknowledge: number; all: number; overdue: number };
}

/** The inbox as one module sees it. `state` is never "empty" while a source is loading or has failed: nothing needs the person is not said before it is known. */
export function workOf(inbox: Inbox, sources: readonly SourceId[]): Work {
  const mine = (item: InboxItem) => sources.includes(item.source);
  const decide = inbox.bySection.decision.filter(mine);
  const acknowledge = inbox.bySection.acknowledgement.filter(mine);
  const states = sources.map((id) => inbox.sources[id]?.state);
  const all = decide.length + acknowledge.length;
  const state: WorkState = all > 0 ? 'content' : states.includes('loading') ? 'loading' : states.includes('unavailable') ? 'unavailable' : 'empty';
  return {
    state, decide, acknowledge,
    notices: inbox.notices.filter((n) => sources.includes(n.source)),
    counts: { decide: decide.length, acknowledge: acknowledge.length, all, overdue: decide.concat(acknowledge).filter((i) => i.overdue).length },
  };
}

// ── the filter and the length ────────────────────────────────────────────────

export type WorkFilter = 'all' | 'decide' | 'ack';

export interface FilterOption { value: WorkFilter; label: string; count: number }

/** All / Decide / Acknowledge with their counts, offered only when both kinds are there (with one kind the filter would only repeat "All"). */
export function filterOptions(work: Work): FilterOption[] {
  const { decide, acknowledge, all } = work.counts;
  return decide > 0 && acknowledge > 0
    ? [{ value: 'all', label: 'All', count: all }, { value: 'decide', label: 'Decide', count: decide }, { value: 'ack', label: 'Acknowledge', count: acknowledge }]
    : [];
}

/** The filter the person chose, or All when what they chose is no longer there (the last acknowledgement was done). */
export function effectiveFilter(work: Work, chosen: WorkFilter): WorkFilter {
  return filterOptions(work).some((o) => o.value === chosen) ? chosen : 'all';
}

export function itemsFor(work: Work, filter: WorkFilter): InboxItem[] {
  return filter === 'decide' ? work.decide : filter === 'ack' ? work.acknowledge : work.decide.concat(work.acknowledge);
}

/** The first `limit` items, the true total, and whether the rest is somewhere else ("Showing 10 of 150"). */
export function lengthOf<T>(items: readonly T[], limit: number): { rows: T[]; total: number; cut: boolean } {
  return { rows: items.slice(0, limit), total: items.length, cut: items.length > limit };
}

/** Where "See all N" goes: the Needs-my-action page, on the section the filter shows (?section= is that page's own address). */
export function seeAllHref(filter: WorkFilter): string {
  return filter === 'decide' ? '/needs-my-action?section=decide' : filter === 'ack' ? '/needs-my-action?section=ack' : '/needs-my-action';
}

// ── one item as a WorkRow ────────────────────────────────────────────────────

/** The tone of the pill that names what is asked: decisions are purple, a change that was not accepted or must be made is amber, an acknowledgement is blue. */
export const KIND_TONE: Record<Kind, Tone> = {
  approval: 'pending', review: 'pending', signoff: 'pending', decide: 'pending', evidence: 'pending', revise: 'warning', changes: 'warning', acknowledgement: 'progress',
};

export interface RowModel {
  key: string;
  kind: { label: string; tone: Tone };
  title: string;
  href: string;
  /** what it is about, then the words it carries (escalated, asked again, archived), as text: a row's context takes no link */
  context: string;
  requester?: { name: string; role: string };
  /** the server's naive-UTC moment; null: no due date */
  due: string | null;
  overdue: boolean;
  /** the row's ONE action: the same word the inbox page says ("Approve and sign", "Acknowledge"), to the same address */
  action: { label: string; href: string };
  /** the second link of an "asked again" row, drawn under it (the kit's row has no slot for a second link) */
  extraLink?: { label: string; href: string };
}

export function rowOf(item: InboxItem): RowModel {
  const words = chipsOf(item).map((w) => inboxChip.label(w));
  const meta = KIND_META[item.kind];
  return {
    key: item.key,
    kind: { label: meta.label, tone: KIND_TONE[item.kind] },
    title: item.title,
    href: item.href,
    context: [item.context, ...words].filter(Boolean).join(' · '),
    requester: item.requester ? { name: item.requester, role: 'Asked by' } : undefined,
    due: item.dueAt,
    overdue: item.overdue,
    action: { label: `${meta.action}${item.again ? ' again' : ''}`, href: item.href },
    extraLink: item.extraLinks[0],
  };
}
