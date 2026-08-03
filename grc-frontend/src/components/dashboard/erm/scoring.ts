// Score bands, severity, and the 85 target — the single source of truth for
// "color = judgment" across the ERM overview. Bands are the product convention:
//   >= 80 strong (green) · >= 60 fair (amber) · < 60 weak (rose) · null "no data" (slate)

export type Band = 'strong' | 'fair' | 'weak' | 'none';

export const TARGET = 85;

export const BAND_COLOR: Record<Band, string> = {
  strong: '#059669',
  fair: '#d97706',
  weak: '#e11d48',
  none: '#94a3b8',
};

export const BAND_LABEL: Record<Band, string> = {
  strong: 'STRONG',
  fair: 'FAIR',
  weak: 'WEAK',
  none: 'NO DATA',
};

/** Tailwind classes for the small band pill shown on each card. */
export const BAND_PILL: Record<Band, string> = {
  strong: 'bg-emerald-50 text-emerald-700',
  fair: 'bg-amber-50 text-amber-700',
  weak: 'bg-rose-50 text-rose-700',
  none: 'bg-slate-100 text-slate-500',
};

export function bandOf(score: number | null | undefined): Band {
  if (score == null) return 'none';
  if (score >= 80) return 'strong';
  if (score >= 60) return 'fair';
  return 'weak';
}

export const bandColor = (score: number | null | undefined): string => BAND_COLOR[bandOf(score)];

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

/** Residual severity on the 0–25 (likelihood × impact) scale. */
export function severityOf(residual: number): { label: Severity; color: string; pill: string } {
  if (residual >= 20) return { label: 'Critical', color: '#dc2626', pill: 'bg-red-50 text-red-700' };
  if (residual >= 12) return { label: 'High', color: '#ea580c', pill: 'bg-orange-50 text-orange-700' };
  if (residual >= 6) return { label: 'Medium', color: '#d97706', pill: 'bg-amber-50 text-amber-700' };
  return { label: 'Low', color: '#16a34a', pill: 'bg-emerald-50 text-emerald-700' };
}

/** 5×5 matrix cell fill: smooth green→red by risk level (likelihood × impact, 1–25). */
export function heatCellColor(level: number): string {
  const hue = Math.round(120 * (1 - (level - 1) / 24));
  const light = 86 - Math.round((level / 25) * 12);
  return `hsl(${hue} 62% ${light}%)`;
}
