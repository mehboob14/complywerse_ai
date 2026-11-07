// The numbers of RCSA and how they read, in one place so every page says the same thing (scores.test.ts).
//   risk score     likelihood x impact, 1 to 25, per question; a unit's overall score is the MEAN of its questions' scores (the server's submit does this).
//                  Bands are the Risk Register's own (>= 20 critical, >= 12 high, >= 6 medium, below that low), not a second scale.
//   control score  per question effective 3, partly 2, ineffective 1 (not applicable counts for nothing); a unit's overall control score is the mean, 1 to 3.
//                  The old Assessments list printed it as "3%" and the campaign page coloured it on the 1-to-25 scale so it was always red.
//   progress       approved units / assigned units of a campaign; a unit's own progress is its required questions answered.
import type { Tone } from '../status.ts';

export type RiskBand = 'critical' | 'high' | 'medium' | 'low';

export function riskBand(score: number | null | undefined): RiskBand | null {
  if (score == null || !(score > 0)) return null;
  return score >= 20 ? 'critical' : score >= 12 ? 'high' : score >= 6 ? 'medium' : 'low';
}

export const BAND_TONE: Record<RiskBand, Tone> = { critical: 'danger', high: 'warning', medium: 'progress', low: 'neutral' };
export const BAND_LABEL: Record<RiskBand, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

/** "11.2 · High" for the average residual, "—" when nothing was scored. One decimal, as the server rounds it to two and a person reads one. */
export function riskText(score: number | null | undefined): string {
  const band = riskBand(score);
  return band ? `${(score as number).toFixed(1)} · ${BAND_LABEL[band]}` : '—';
}

export type ControlBand = 'strong' | 'partial' | 'weak';

/** The mean control score on its own 1-to-3 scale: from 2.5 the controls work, from 1.5 they partly do, below that they do not. */
export function controlBand(score: number | null | undefined): ControlBand | null {
  if (score == null || !(score > 0)) return null;
  return score >= 2.5 ? 'strong' : score >= 1.5 ? 'partial' : 'weak';
}

export const CONTROL_TONE: Record<ControlBand, Tone> = { strong: 'success', partial: 'warning', weak: 'danger' };
export const CONTROL_LABEL: Record<ControlBand, string> = { strong: 'Working', partial: 'Partly working', weak: 'Not working' };

/** "2.3 of 3 · Partly working", "—" when nothing was scored. */
export function controlText(score: number | null | undefined): string {
  const band = controlBand(score);
  return band ? `${(score as number).toFixed(1)} of 3 · ${CONTROL_LABEL[band]}` : '—';
}

/** A whole percent from a count and a total (0 when there is nothing to count): "5 of 14" is 35, not 36, because a unit is not done at 35.7. */
export function percent(done: number, total: number): number {
  return total > 0 ? Math.floor((done * 100) / total) : 0;
}

/** The tone of a progress bar: done is green, behind (the due date has passed) is red, otherwise the brand. */
export function progressTone(pct: number, late: boolean): 'success' | 'danger' | 'default' {
  return pct >= 100 ? 'success' : late ? 'danger' : 'default';
}
