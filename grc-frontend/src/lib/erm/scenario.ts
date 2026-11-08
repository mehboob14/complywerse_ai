// What-if scenarios, apart from React (`node --test src/lib/erm/scenario.test.ts`). The server runs the arithmetic (POST scenario-analysis: adjusted = likelihood x impact,
// change, percent, totals); this decides WHAT is sent and how the answer is read:
//   - a preset moves only the risks in its `categories_affected` (when it has any): "Economic downturn" used to raise every selected risk
//   - a risk with no likelihood and impact for the chosen score type cannot be compared, so it cannot be picked (the page built its adjusted score from an assumed 3)
//   - the server's percent is null when the original score is 0: it is shown as "New", never formatted (that threw and the results table did not draw)
import { scoreBand, BAND_LABEL, type Band } from './band.ts';

export type ScoreType = 'inherent' | 'residual';

export interface ScenarioRisk {
  id: number;
  title: string;
  category?: string | null;
  risk_category?: string | null;
  inherent_likelihood?: number | null;
  inherent_impact?: number | null;
  residual_likelihood?: number | null;
  residual_impact?: number | null;
}

export interface Preset { id: string; name: string; description: string; likelihood_adjustment?: number; impact_adjustment?: number; categories_affected?: string[] }

export const clamp = (n: number): number => Math.min(5, Math.max(1, Math.round(n)));

export function baseOf(r: ScenarioRisk, score: ScoreType): { likelihood: number; impact: number } | null {
  const l = score === 'inherent' ? r.inherent_likelihood : r.residual_likelihood;
  const i = score === 'inherent' ? r.inherent_impact : r.residual_impact;
  return typeof l === 'number' && l > 0 && typeof i === 'number' && i > 0 ? { likelihood: l, impact: i } : null;
}

export const isEligible = (r: ScenarioRisk, score: ScoreType): boolean => baseOf(r, score) !== null;

/** The category a preset looks at: the register's `risk_category` (what the server's list and heat map group by), else `category`. */
const categoryOfRisk = (r: ScenarioRisk): string => r.risk_category || r.category || '';

export interface Adjusted { risk_id: number; adjusted_likelihood: number; adjusted_impact: number; scenario_name: string }

/** The scenarios to send for a preset: each eligible risk moved by the preset, or left where it is when the preset does not touch its category. */
export function applyPreset(preset: Preset, risks: readonly ScenarioRisk[], score: ScoreType): Adjusted[] {
  const out: Adjusted[] = [];
  risks.forEach((r) => {
    const base = baseOf(r, score);
    if (!base) return;
    const touched = !preset.categories_affected || preset.categories_affected.length === 0 || preset.categories_affected.includes(categoryOfRisk(r));
    out.push({
      risk_id: r.id,
      adjusted_likelihood: touched ? clamp(base.likelihood + (preset.likelihood_adjustment ?? 0)) : base.likelihood,
      adjusted_impact: touched ? clamp(base.impact + (preset.impact_adjustment ?? 0)) : base.impact,
      scenario_name: preset.name,
    });
  });
  return out;
}

/** A custom adjustment: the risk's own values with the person's overrides, clamped to 1-5. */
export function applyCustom(risks: readonly ScenarioRisk[], score: ScoreType, overrides: Readonly<Record<number, { likelihood?: number; impact?: number }>>): Adjusted[] {
  const out: Adjusted[] = [];
  risks.forEach((r) => {
    const base = baseOf(r, score);
    if (!base) return;
    const o = overrides[r.id] ?? {};
    out.push({ risk_id: r.id, adjusted_likelihood: clamp(o.likelihood ?? base.likelihood), adjusted_impact: clamp(o.impact ?? base.impact), scenario_name: 'Custom scenario' });
  });
  return out;
}

export interface ScenarioRow {
  risk_id: number; risk_title: string; original_score: number | null; adjusted_score: number; score_change: number; score_change_pct: number | null;
}

/** "+25%", "-10%", "0%", or "New" when the risk had no score to start from. */
export function percentWords(pct: number | null | undefined): string {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 'New';
  const r = Math.round(pct * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}%`;
}

/** The change in words and a direction, so it never relies on colour: "+6 (worse)", "-4 (better)", "no change". */
export function changeWords(change: number): string {
  if (change > 0) return `+${change} (worse)`;
  if (change < 0) return `${change} (better)`;
  return 'no change';
}

export const bandWord = (score: number | null | undefined): string => {
  const b: Band | null = scoreBand(score);
  return b ? BAND_LABEL[b] : 'Not scored';
};
