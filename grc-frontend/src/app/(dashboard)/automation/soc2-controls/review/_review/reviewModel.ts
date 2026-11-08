// What the Mapping review page decides, apart from React so `node --test` pins it (reviewModel.test.ts): the identity of a queue item (the decision is keyed on it, not on a row id, so it survives the
// next SCF release), which item is next once one is decided, what each verdict says to the person before and after, whether a retarget is allowed, and the words about the queue. The queue is the server's
// (GET /automation/common/review-queue: worst first by confidence, then fan-out, then material controls); nothing here re-ranks it.
export interface QueueItem {
  source_slug: string;
  framework: string;
  requirement_code: string;
  reference: string;
  requirement_title: string | null;
  scf_id: string;
  confidence: number;
  match_mode: string;
  provenance: string;
  /** requirement fan-out + control fan-out; high means the mapping is diluted */
  fan_out: number;
  is_material: boolean;
}
export interface Queue { release: string; remaining: number; reviewed: number; items: QueueItem[] }

export type Verdict = 'confirmed' | 'suppressed' | 'retargeted';

export const identity = (i: Pick<QueueItem, 'source_slug' | 'requirement_code' | 'scf_id'>): string => `${i.source_slug}|${i.requirement_code}|${i.scf_id}`;

/** The item to show once `key` has been decided: the one that took its place in the list, else the one before it, else none. `before` is the list as it was, `after` as it is now. */
export function nextKey(before: readonly QueueItem[], after: readonly QueueItem[], key: string): string | null {
  const afterKeys = after.map(identity);
  if (afterKeys.length === 0) return null;
  const at = before.findIndex((i) => identity(i) === key);
  const survivors = before.slice(at < 0 ? 0 : at + 1).map(identity).find((k) => afterKeys.includes(k));
  if (survivors) return survivors;
  const beforeKeys = before.map(identity);
  const fresh = afterKeys.find((k) => !beforeKeys.includes(k));                  // the queue refilled at its end: the item that took the decided one's place
  if (fresh) return fresh;
  const earlier = before.slice(0, Math.max(at, 0)).map(identity).reverse().find((k) => afterKeys.includes(k));
  return earlier ?? afterKeys[0];
}

/** The item that is open: the one chosen if it is still in the queue, else the first. */
export function openKey(items: readonly QueueItem[], chosen: string | null): string | null {
  if (items.length === 0) return null;
  return chosen && items.some((i) => identity(i) === chosen) ? chosen : identity(items[0]);
}

export const VERDICT_WORDS: Record<Verdict, { done: string; verb: string }> = {
  confirmed: { done: 'Mapping confirmed', verb: 'Confirm' },
  suppressed: { done: 'Mapping suppressed', verb: 'Suppress' },
  retargeted: { done: 'Mapping moved', verb: 'Move' },
};

/** What the person is told before a decision that cannot be taken back lightly; a confirmation needs no question (the mapping simply stands). */
export function questionFor(v: Verdict, item: Pick<QueueItem, 'reference' | 'scf_id'>, target?: string): { title: string; message: string; confirmLabel: string } | null {
  if (v === 'suppressed') {
    return {
      title: `Suppress ${item.reference} → ${item.scf_id}?`,
      message: 'The mapping is treated as wrong and left out wherever requirements are grouped. The decision is kept across SCF releases, so it does not come back.',
      confirmLabel: 'Suppress mapping',
    };
  }
  if (v === 'retargeted') {
    return {
      title: `Move ${item.reference} from ${item.scf_id} to ${target ?? 'another control'}?`,
      message: 'The requirement is right, the control is wrong. The new control is shown beside the crosswalk’s own rows from now on, and the decision is kept across SCF releases.',
      confirmLabel: 'Move mapping',
    };
  }
  return null;
}

/** A retarget needs a control, and not the one it already points at. */
export const canRetarget = (target: string | null | undefined, item: Pick<QueueItem, 'scf_id'>): boolean => !!target && target.trim() !== '' && target.trim().toUpperCase() !== item.scf_id.toUpperCase();

export const MATCH_WORDS: Record<string, string> = { exact: 'Exact match', parent: 'Matched by a parent code', child: 'Matched by a child code' };
export const matchWords = (mode: string): string => MATCH_WORDS[mode] ?? mode.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** "50 of 1,204 waiting": what the list holds of what remains. */
export function queueWords(shown: number, remaining: number, format: (n: number) => string): string {
  if (remaining <= 0) return 'Nothing is waiting';
  return shown >= remaining ? `${format(remaining)} waiting` : `${format(shown)} of ${format(remaining)} waiting`;
}
