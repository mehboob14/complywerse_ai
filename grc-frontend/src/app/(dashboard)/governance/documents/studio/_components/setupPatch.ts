/**
 * The instructions changes not saved yet: merged as the person goes on (a later value of a key wins), sent one save at a time as one
 * patch, and laid over the server's copy, so a reload never wipes what is still on its way. A save stays laid over the server's copy
 * until a copy fetched after it arrives (an older answer cannot undo it), and text the server only trimmed is kept as typed (the
 * space or new line the person is about to follow with is not taken away). Pure, so `npm test` checks it.
 */
export type Patch = Record<string, unknown>;

export class PatchQueue {
  pending: Patch | null = null;
  inflight: Patch | null = null;
  /** saved, but no copy of the server fetched after the save has come back yet */
  acked: Patch | null = null;
  /** what the person last typed in each text field */
  typed: Record<string, string> = {};

  add(patch: Patch) {
    this.pending = { ...(this.pending ?? {}), ...patch };
    for (const [k, v] of Object.entries(patch)) if (typeof v === 'string') this.typed[k] = v;
  }

  /** The patch to send now, or null while a save is on its way or nothing waits. */
  take(): Patch | null {
    if (this.inflight || !this.pending) return null;
    this.inflight = this.pending;
    this.pending = null;
    return this.inflight;
  }

  done() {
    this.acked = { ...(this.acked ?? {}), ...(this.inflight ?? {}) };
    this.inflight = null;
  }

  /** A copy of the server fetched after the saves arrived: it has them. */
  settled() {
    if (!this.inflight && !this.pending) this.acked = null;
  }

  /** A save that failed: its changes wait again, under anything newer. */
  failed() {
    if (this.inflight) this.pending = { ...this.inflight, ...(this.pending ?? {}) };
    this.inflight = null;
  }

  /** The server's copy with what is not saved (or not yet seen saved) on top, and text kept as typed where the server only trimmed it. */
  view<T extends Patch>(server: T): T {
    const out: Patch = { ...server, ...(this.acked ?? {}), ...(this.inflight ?? {}), ...(this.pending ?? {}) };
    for (const [k, v] of Object.entries(this.typed)) if (typeof out[k] === 'string' && out[k] === v.trim().slice(0, 3000)) out[k] = v;
    return out as T;
  }
}

/** One queue per session, so the Instructions tab and the chat's setup card never replay each other's old changes. */
const queues = new Map<number, PatchQueue>();
export const queueFor = (sessionId: number): PatchQueue => {
  let q = queues.get(sessionId);
  if (!q) { q = new PatchQueue(); queues.set(sessionId, q); }
  return q;
};
