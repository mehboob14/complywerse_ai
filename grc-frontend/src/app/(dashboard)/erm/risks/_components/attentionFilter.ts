// The Overview's attention tiles open the register on the risks they count (the register section of
// backend/grc/modules/erm/routers/dashboard.py): active = not closed, scored = both inherent and residual scores.
import { riskBandForScore } from '../../../../../lib/riskBands.ts';

export type AttentionFilter = 'critical_open' | 'unscored';

export const ATTENTION_FILTER_LABEL: Readonly<Record<AttentionFilter, string>> = {
  critical_open: 'Critical open risks',
  unscored: 'Unscored active risks',
};

interface ScoredRisk {
  status?: string | null;
  inherent_score?: number | null;
  residual_score?: number | null;
}

/** The tile filter a `?filter=` value names; null for anything else. */
export function attentionFilterOf(value: string | null | undefined): AttentionFilter | null {
  return value === 'critical_open' || value === 'unscored' ? value : null;
}

/** Whether the tile counts this risk: an active risk that is critical on residual, or that lacks either score. */
export function matchesAttentionFilter(risk: ScoredRisk, filter: AttentionFilter | null): boolean {
  if (!filter) return true;
  if (risk.status === 'closed') return false;
  const scored = risk.inherent_score != null && risk.residual_score != null;
  return filter === 'unscored' ? !scored : scored && riskBandForScore(risk.residual_score) === 'critical';
}
