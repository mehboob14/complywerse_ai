// What a StatTile and a ProgressBar decide, apart from React so `node --test` can pin it (statModel.test.ts): which of a tile's four states it is in
// (a failure and a wait are never shown as a figure, and a missing figure is never 0), and what a bar says about its value (a stored number outside
// 0-100 fills the track and no more, a missing one is not 0%). The components are StatTile.tsx and ProgressBar.tsx.
import { formatPercent } from '../../../lib/format.ts';

/** What a figure that has not been recorded says: not 0, not a dash that means nothing. */
export const NOT_RECORDED = 'Not recorded';

export type TileState = 'error' | 'loading' | 'empty' | 'value';

/** Which of its four states a tile is in. The order matters: a failed request is said (with Retry) before a wait is shown, a wait before a missing figure,
 *  and the figure only when there is one. A tile is never a 0 that stands for "failed", "loading" or "nothing recorded". */
export function tileState({ error, loading, value }: { error: boolean; loading: boolean; value: string | null | undefined }): TileState {
  if (error) return 'error';
  if (loading) return 'loading';
  return value == null ? 'empty' : 'value';
}

export interface BarReading {
  /** how much of the track is filled, 0 to 100; null when no value is recorded (no bar is drawn) */
  percent: number | null;
  /** aria-valuenow: the filled share, a whole number; null with no value */
  now: number | null;
  /** the words: "72%", the caller's own ("3 of 5"), or "Not recorded" */
  text: string;
}

/** What a bar shows for `value` (a percent: 72 is 72%). A number outside 0-100 fills the track and no more, and the words still say the stored figure
 *  ("120%"). Nothing, a blank, text that is not a number and NaN are not recorded: they are never read as 0%. `valueText` replaces the words. */
export function barReading(value: unknown, valueText?: string): BarReading {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return { percent: null, now: null, text: NOT_RECORDED };
  const percent = Math.max(0, Math.min(100, n));
  return { percent, now: Math.round(percent), text: valueText?.trim() || formatPercent(n) };
}
