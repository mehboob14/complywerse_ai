// What the cockpit frame decides, apart from React so `node --test` can pin it (cockpitModel.test.ts): which layout the page takes, in what order the
// counters stand and how many of them a phone shows, and how many rows the worklist shows. The frame is Cockpit.tsx; the Governance Overview is its first
// content (governance/_overview). Nothing here knows a module: a counter is a label, a state and a number.

/** `full`: the worklist beside the posture. `solo`: the person has little to do, so the worklist is a short strip and the posture takes the width.
 *  `work-only`: the person may not read the programme's scores (the server refused them), so that is said once and their own work takes the page. */
export type CockpitMode = 'full' | 'solo' | 'work-only';

/** A worklist with this many items or fewer is a short strip. */
export const SOLO_AT = 3;

/** How many rows the worklist shows before "See all": ten on a screen, five on a phone, and the strip's three. */
export const WORK_ROWS = { full: 10, narrow: 5, solo: SOLO_AT } as const;

export function layoutOf({ refused, workCount }: { refused: boolean; /** null while the worklist has not answered, or could not */ workCount: number | null }): CockpitMode {
  if (refused) return 'work-only';
  return workCount !== null && workCount <= SOLO_AT ? 'solo' : 'full';
}

/** How many worklist rows a mode shows. A strip is a strip on a phone too. */
export const workRowLimit = (mode: CockpitMode, narrow: boolean): number => (mode === 'solo' ? WORK_ROWS.solo : narrow ? WORK_ROWS.narrow : WORK_ROWS.full);

// ── the counters band ────────────────────────────────────────────────────────

/** A phone shows this many counters until the person asks for the rest. */
export const PHONE_COUNTERS = 3;

export interface Countable { state: 'ready' | 'loading' | 'error' | 'none'; value?: number }

const lit = (c: Countable): boolean => c.state === 'ready' && (c.value ?? 0) > 0;

/** The counters with something to look at first, the zeros and the ones that could not be read after them; each group keeps its own order, so the
 *  page never shuffles two counters of the same kind. Every counter stays one press away. */
export function orderCounters<T extends Countable>(counters: readonly T[]): T[] {
  return counters.filter(lit).concat(counters.filter((c) => !lit(c)));
}

/** What the band draws: all of them, or on a phone the first three with a button for the rest. */
export function foldCounters<T>(counters: readonly T[], { narrow, all }: { narrow: boolean; all: boolean }): { shown: T[]; foldable: boolean; folded: boolean } {
  const foldable = narrow && counters.length > PHONE_COUNTERS;
  const folded = foldable && !all;
  return { shown: folded ? counters.slice(0, PHONE_COUNTERS) : counters.slice(), foldable, folded };
}

/** "Show all 8" / "Show fewer": the button that opens and shuts the folded band. */
export const foldLabel = (total: number, folded: boolean): string => (folded ? `Show all ${total}` : 'Show fewer');
