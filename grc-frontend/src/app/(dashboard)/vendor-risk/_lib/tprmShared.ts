// Shared constants + helpers for the TPRM screens (dashboard, findings,
// monitoring, risk 360°). Hex values are for recharts; the *Cls helpers return
// soft-tone Tailwind classes consistent with the rest of the platform.

export const TIER_ORDER = ['critical', 'high', 'medium', 'low'] as const;

// Severity / tier share one palette so the language is consistent everywhere.
export const SEV_HEX: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#22c55e', info: '#64748b',
};

export const DOMAIN_LABELS: Record<string, string> = {
  cybersecurity: 'Cybersecurity',
  data_privacy: 'Data Privacy',
  operational: 'Operational Resilience',
  financial: 'Financial Viability',
  compliance: 'Compliance & Regulatory',
  reputational: 'Reputational',
  geographic: 'Geographic/Geopolitical',
  fourth_party: 'Fourth-Party/Concentration',
  esg: 'ESG & Sustainability',
  legal: 'Legal & Contractual',
};
export const DOMAIN_KEYS = Object.keys(DOMAIN_LABELS);

// Per-domain hex for the radar / domain charts.
export const DOMAIN_HEX: Record<string, string> = {
  cybersecurity: '#4C8DFF', data_privacy: '#9D7BFF', operational: '#37D67A', financial: '#37C9D6',
  compliance: '#F4C430', reputational: '#FF8A3D', geographic: '#E56AAE', fourth_party: '#7C8AFF',
  esg: '#5BD68C', legal: '#94a3b8',
};

export function sevBadgeCls(sev?: string | null): string {
  const s = (sev || '').toLowerCase();
  const map: Record<string, string> = {
    critical: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-orange-50 text-orange-700 border-orange-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return map[s] || 'bg-gray-100 text-gray-600 border-gray-200';
}

// A–F grade → text colour (A best … F worst).
export function gradeColor(grade?: string | null): string {
  const map: Record<string, string> = {
    A: 'text-emerald-600', B: 'text-green-600', C: 'text-amber-600',
    D: 'text-orange-600', E: 'text-orange-700', F: 'text-red-600',
  };
  return map[(grade || '').toUpperCase()] || 'text-gray-500';
}

// Residual score (0..100, lower = better) → colour band.
export function scoreColor(score?: number | null): string {
  if (score == null) return '#94a3b8';
  if (score >= 70) return SEV_HEX.critical;
  if (score >= 48) return SEV_HEX.high;
  if (score >= 26) return SEV_HEX.medium;
  return SEV_HEX.low;
}

export const STATUS_LABELS: Record<string, string> = {
  open: 'Open', in_remediation: 'In Progress', in_progress: 'In Progress',
  accepted: 'Accepted', closed: 'Remediated',
};

export function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

export function titleCase(s?: string | null): string {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
