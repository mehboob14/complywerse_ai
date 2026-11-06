// "Waiting for me": the documents that wait for the signed-in person's decision, read from the inbox the top bar and Needs my action already ask for (lib/inbox: the same
// query keys, so the library asks for nothing more). The rule is the inbox's own count rule: a decision ADDRESSED to the person (review, approval, a proposed change to decide,
// a change to revise, a sign-off) on a document; an acknowledgement is not a decision, a request the person SENT is not waiting for them, and a source that has not answered
// is said, never counted as nobody. Pure (no React), so `node --test` checks it: waitingModel.test.ts.
import type { Inbox, SourceId } from '../../../../../lib/inbox/buildInbox.ts';

/** The inbox sources that name documents waiting for a decision. */
export const WAITING_SOURCES: readonly SourceId[] = ['doc.lifecycle', 'doc.signoff'];

export type WaitingState =
  /** a source is still being asked for the first time and nothing has answered: the count is not known */
  | 'loading'
  /** answered (a source may be a refresh behind) */
  | 'ready'
  /** a source never answered: what is listed may be incomplete */
  | 'unavailable';

export interface Waiting {
  ids: ReadonlySet<number>;
  state: WaitingState;
}

export function waitingForMe(inbox: Pick<Inbox, 'items' | 'sources'>): Waiting {
  const states = WAITING_SOURCES.map((id) => inbox.sources[id]?.state);
  const ids = new Set<number>();
  for (const item of inbox.items) {
    if (!WAITING_SOURCES.includes(item.source) || item.section !== 'decision' || !item.counted || item.documentId == null) continue;
    ids.add(item.documentId);
  }
  if (states.every((s) => s === undefined || s === 'loading')) return { ids, state: 'loading' };
  if (states.some((s) => s === 'unavailable')) return { ids, state: 'unavailable' };
  return { ids, state: 'ready' };
}

/** What the "Waiting for me" chip counts: the number, or null while it is not known (the chip then draws no number rather than 0). */
export const waitingCount = (w: Waiting, rows: readonly { id: number }[]): number | null =>
  w.state === 'loading' ? null : rows.reduce((n, d) => n + (w.ids.has(d.id) ? 1 : 0), 0);

/** The words said above the list while the view is on and the answer is not whole; null when there is nothing to say. */
export function waitingNote(w: Waiting): { title: string; detail: string } | null {
  if (w.state === 'loading') return { title: 'Reading what waits for you', detail: 'The list fills in when the requests have been read.' };
  if (w.state === 'unavailable') return { title: 'What waits for you could not be fully read', detail: 'Some of your requests did not load, so documents may be missing here. Try again in a moment, or open Needs my action.' };
  return null;
}
