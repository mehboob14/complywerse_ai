// One severity band for a 1–25 likelihood × impact score, everywhere in Risk Management.
// Mirrors backend risk_priority_for_score (backend/grc/models/_11_enterprise_risk_management.py).

export type RiskBand = 'critical' | 'high' | 'medium' | 'low';

export const RISK_BAND_MIN: Readonly<Record<RiskBand, number>> = { critical: 20, high: 12, medium: 6, low: 1 };

/** The band a 1–25 score falls in; null when the risk has not been scored. */
export function riskBandForScore(score: number | null | undefined): RiskBand | null {
  if (!score) return null;
  if (score >= RISK_BAND_MIN.critical) return 'critical';
  if (score >= RISK_BAND_MIN.high) return 'high';
  if (score >= RISK_BAND_MIN.medium) return 'medium';
  return 'low';
}
