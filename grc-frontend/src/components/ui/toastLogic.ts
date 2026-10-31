// What a toast decides apart from React, so `node --test` can pin it (toastLogic.test.ts): how long it lives when someone is reading it,
// and which toasts to drop when there are too many.

export interface ToastTimer {
  /** begin, or go on counting after a pause */
  start: () => void;
  /** stop counting, keeping what is left */
  pause: () => void;
}

/**
 * The auto-dismiss clock of one toast: it runs for `duration` ms in all, but only while it is not paused (the pointer is over the toast, or focus is
 * inside it), and a pause never sends it back to the start. A `duration` of 0 never runs: the toast stays until someone dismisses it.
 */
export function createToastTimer(duration: number, onDone: () => void): ToastTimer {
  let left = duration;
  let startedAt = 0;
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    start() {
      if (handle !== null || left <= 0) return;                  // already counting, or nothing (left) to count
      startedAt = Date.now();
      handle = setTimeout(() => { handle = null; left = 0; onDone(); }, left);
    },
    pause() {
      if (handle === null) return;
      clearTimeout(handle);
      handle = null;
      left = Math.max(0, left - (Date.now() - startedAt));
    },
  };
}

/**
 * The toasts to keep when there are more than `max` (the last one is the newcomer): the oldest goes, except that a toast that stays until
 * dismissed (duration 0: an error somebody has not read yet) outlives one that goes by itself, and the newcomer is never the one dropped.
 * With no toast that stays this is simply the newest `max`.
 */
export function keepToasts<T extends { duration?: number }>(toasts: T[], max: number): T[] {
  const kept = [...toasts];
  while (kept.length > Math.max(1, max)) {
    const goesByItself = kept.slice(0, -1).findIndex((t) => t.duration !== 0);
    kept.splice(goesByItself === -1 ? 0 : goesByItself, 1);
  }
  return kept;
}
