// One request for the badges of a whole table: the badge of each row asks for its own record, and the asks that arrive in the same moment (one render of a list) leave as ONE
// call to GET /issue-management/by-source/counts (up to 200 records of one type). Pure apart from the timer and the `load` it is given, so `node --test` runs countBatch.test.ts.
// A record the server leaves out of its answer is an error, never a zero: a failed read must not look like "no issues".
import type { Counts } from './embedModel.ts';

export type LoadCounts = (type: string, ids: number[]) => Promise<Record<string, Counts>>;

interface Batch {
  ids: Set<number>;
  waiters: Array<{ id: number; resolve: (c: Counts) => void; reject: (e: unknown) => void }>;
  timer: ReturnType<typeof setTimeout>;
}

/** `wait` is how long (ms) the first ask waits for the others of its type; `max` is the most records in one call (the server's limit is 200). */
export function makeCountBatcher(load: LoadCounts, { wait = 25, max = 200 }: { wait?: number; max?: number } = {}) {
  const open = new Map<string, Batch>();

  function flush(type: string): void {
    const batch = open.get(type);
    if (!batch) return;
    open.delete(type);
    clearTimeout(batch.timer);
    load(type, Array.from(batch.ids)).then(
      (answer) => batch.waiters.forEach((w) => {
        const counts = answer[String(w.id)];
        if (counts) w.resolve(counts); else w.reject(new Error('The server left this record out of its answer.'));
      }),
      (error) => batch.waiters.forEach((w) => w.reject(error)),
    );
  }

  return (type: string, id: number): Promise<Counts> => new Promise<Counts>((resolve, reject) => {
    let batch = open.get(type);
    if (!batch) {
      batch = { ids: new Set<number>(), waiters: [], timer: setTimeout(() => flush(type), wait) };
      open.set(type, batch);
    }
    batch.ids.add(id);
    batch.waiters.push({ id, resolve, reject });
    if (batch.ids.size >= max) flush(type);
  });
}
