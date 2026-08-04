// Governance Overview — types (data comes from the live documents-overview API).

export interface Metric {
  /** Human-readable metric name shown in the breakdown modal. */
  label: string;
  /** 0–100 score for this metric. */
  score: number;
  /** Numerator for the "x / y" fraction (0 = derived / no raw count). */
  num: number;
  /** Denominator for the "x / y" fraction (0 = derived / no raw count). */
  den: number;
  /** Weight of this metric within its section (0–1, should sum to 1). */
  w: number;
  /** Plain-language formula shown under the bar. */
  formula: string;
}

export interface Section {
  key: string;
  label: string;
  /** Short label used in compact spots. */
  short: string;
  /** Weight of this section within the overall score (0–1, should sum to 1). */
  weight: number;
  metrics: Metric[];
  /**
   * Optional server-computed section score. A number is used directly; `null`
   * marks a section that has no data yet (rendered as "no data"); `undefined`
   * means recompute from `metrics`.
   */
  score?: number | null;
}
