// What "a KRI is breaching" means, once, for the KRI register, its board, the KRI triggers tool and the counts that link in. It is the Overview's reading (backend
// modules/erm/routers/dashboard.py `kri_is_red` and `kri_band_health`), applied to the value the server hydrates (a live-fed KRI's value included):
//   red     the value is past the AMBER threshold, in the direction the KRI says is bad (lower_is_better: above it; higher_is_better: below it)
//   amber   not red, and past the GREEN threshold (or no green threshold is set to be inside)
//   green   at or inside the green threshold
//   unrated no amber threshold is set: there is nothing to judge against
//   no_value nothing has been measured (the Overview scores an unmeasured KRI against the programme, but never counts it as red)
// The older pages used three answers (the page's alert list, the KRI Triggers endpoint, the Overview). Pure, `node --test src/lib/erm/kri.test.ts`.
import { norm } from '../status.ts';

export type KriState = 'red' | 'amber' | 'green' | 'unrated' | 'no_value';

export interface KriLike {
  current_value: number | null | undefined;
  green_threshold: number | null | undefined;
  amber_threshold: number | null | undefined;
  threshold_direction: string | null | undefined;
}

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** The server's reading of the direction: anything that starts with "higher" is higher-is-better, everything else lower-is-better. */
export const higherIsBetter = (k: Pick<KriLike, 'threshold_direction'>): boolean => norm(k.threshold_direction).startsWith('higher');

export function kriState(k: KriLike): KriState {
  if (!num(k.current_value)) return 'no_value';
  if (!num(k.amber_threshold)) return 'unrated';
  const v = k.current_value;
  if (higherIsBetter(k)) {
    if (v < k.amber_threshold) return 'red';
    return num(k.green_threshold) && v >= k.green_threshold ? 'green' : 'amber';
  }
  if (v > k.amber_threshold) return 'red';
  return num(k.green_threshold) && v <= k.green_threshold ? 'green' : 'amber';
}

/** A breach is a red KRI: the Overview's "Red KRIs". Amber is "watch", not a breach. */
export const isBreach = (k: KriLike): boolean => kriState(k) === 'red';
export const isWatch = (k: KriLike): boolean => kriState(k) === 'amber';

/** The word of the shared `rag` registry (lib/status.ts) a state is shown as. */
export function ragWord(state: KriState): 'red' | 'amber' | 'green' | 'unknown' {
  return state === 'red' || state === 'amber' || state === 'green' ? state : 'unknown';
}

/** Worst first for a sort: red, amber, green, unrated, no value. */
export const STATE_RANK: Readonly<Record<KriState, number>> = { red: 0, amber: 1, green: 2, unrated: 3, no_value: 4 };

export interface KriCounts { red: number; amber: number; green: number; unrated: number; no_value: number; total: number }

export function kriCounts(kris: readonly KriLike[]): KriCounts {
  const out: KriCounts = { red: 0, amber: 0, green: 0, unrated: 0, no_value: 0, total: kris.length };
  kris.forEach((k) => { out[kriState(k)] += 1; });
  return out;
}

// ── the threshold bar: where the value stands between the zones, for the direction the KRI has ──
export interface BarZone { state: 'green' | 'amber' | 'red'; from: number; to: number }
export interface ThresholdBar {
  zones: BarZone[];
  /** 0-100: where the value sits along the bar */
  marker: number | null;
  max: number;
}

/**
 * The zones as shares of the bar (0-100). The bar runs from 0 to max(green, amber, value) x 1.2 (100 when all are 0), as the trigger track always did, but the zones
 * follow the DIRECTION: lower-is-better has green first and red last; higher-is-better has red first and green last (the old track drew the red region on the wrong side
 * for the form's default higher-is-better 80 / 50). null when the thresholds are not both set.
 */
export function thresholdBar(k: KriLike): ThresholdBar | null {
  if (!num(k.green_threshold) || !num(k.amber_threshold)) return null;
  const peak = Math.max(k.green_threshold, k.amber_threshold, num(k.current_value) ? k.current_value : 0);
  const max = peak > 0 ? peak * 1.2 : 100;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / max) * 100));
  const g = pct(k.green_threshold);
  const a = pct(k.amber_threshold);
  const zones: BarZone[] = higherIsBetter(k)
    ? [{ state: 'red', from: 0, to: a }, { state: 'amber', from: a, to: g }, { state: 'green', from: g, to: 100 }]
    : [{ state: 'green', from: 0, to: g }, { state: 'amber', from: g, to: a }, { state: 'red', from: a, to: 100 }];
  return { zones: zones.filter((z) => z.to > z.from), marker: num(k.current_value) ? pct(k.current_value) : null, max };
}

/** The thresholds in words, for the direction ("On track at or below 5; Watch up to 10; above that Off target"). */
export function thresholdWords(k: KriLike, unit?: string | null): string {
  if (!num(k.green_threshold) || !num(k.amber_threshold)) return 'Thresholds not set';
  const u = unit === '%' || unit === 'pct' ? '%' : unit === 'days' ? ' days' : '';
  return higherIsBetter(k)
    ? `On track at ${k.green_threshold}${u} or more; Watch down to ${k.amber_threshold}${u}; below that Off target`
    : `On track at ${k.green_threshold}${u} or less; Watch up to ${k.amber_threshold}${u}; above that Off target`;
}

export interface KriGap { /** how far the value is from the next better state, in the KRI's own unit */ amount: number; /** the state it would reach */ to: 'amber' | 'green' }

/**
 * How far a red or amber KRI is from the next better state: a red one from the amber threshold, an amber one from the green threshold (the figure the KRI triggers page has always
 * recommended: "reduce it by at least N to return within threshold"). null for a KRI that is not red or amber.
 */
export function kriGap(k: KriLike): KriGap | null {
  const state = kriState(k);
  if (state !== 'red' && state !== 'amber') return null;
  const v = k.current_value as number;
  const target = (state === 'red' ? k.amber_threshold : k.green_threshold) as number;
  if (!num(target)) return null;
  const amount = Math.round((higherIsBetter(k) ? target - v : v - target) * 100) / 100;
  return amount > 0 ? { amount, to: state === 'red' ? 'amber' : 'green' } : null;
}
