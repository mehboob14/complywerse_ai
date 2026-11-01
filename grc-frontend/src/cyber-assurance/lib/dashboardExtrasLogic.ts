/**
 * Pure derivations for the Performance dashboard's extra lenses (PCI compliance,
 * Help Desk KPIs). No I/O, no React, no imports — so the maths is unit-testable and
 * the hooks in dashboardExtrasApi.ts stay thin.
 *
 * Honesty rules (same as the rest of the dashboard): every figure is computed from a
 * real field a module endpoint returned; "unknown" is never rounded into "fine".
 */

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const sumBy = <T,>(xs: T[], pick: (x: T) => unknown): number => xs.reduce((s, x) => s + num(pick(x)), 0);

/* =====================================================================================
   Help Desk — GET /helpdesk/dashboard-overview   (helpdesk_native/dashboard.py :: analytics)
   ===================================================================================== */

export type HdTrendRow = { date: string; created: number; resolved: number };
/** Exactly the keys the endpoint returns. With no from_date/to_date the KPIs and
 *  breakdowns cover ALL tickets and `trend` is the trailing 30 days. */
export type HdOverview = {
  total: number;
  sla_fulfilled_pct: number | null;
  avg_first_response_hours: number | null;
  avg_resolution_days: number | null;
  avg_feedback_rating: number | null;
  feedback_count: number;
  trend: HdTrendRow[];
  by_team?: Record<string, number>;
  by_priority?: Record<string, number>;
  by_type?: Record<string, number>;
  by_status_category?: Record<string, number>;
};
/** ok = payload present · forbidden = 403 (no helpdesk:tickets:view) · missing = 404 (module not provisioned). */
export type HdAccess = 'ok' | 'forbidden' | 'missing';
export type HdResult = { access: HdAccess; overview: HdOverview | null };

/** Same shape as charts.tsx `Week`, so it feeds <FlowChart weeks=…> directly. */
export type HdWeek = { from: string; to: string; added: number; resolved: number };

/** Daily trend rows → 7-day buckets, oldest first (the last bucket may be a partial, current week). */
export function weeklyBuckets(trend: HdTrendRow[] | null | undefined): HdWeek[] {
  const rows = (Array.isArray(trend) ? trend : []).filter((r) => r && typeof r.date === 'string');
  const out: HdWeek[] = [];
  for (let i = 0; i < rows.length; i += 7) {
    const chunk = rows.slice(i, i + 7);
    out.push({
      from: chunk[0].date,
      to: chunk[chunk.length - 1].date,
      added: sumBy(chunk, (r) => r.created),
      resolved: sumBy(chunk, (r) => r.resolved),
    });
  }
  return out;
}

export type HdKpis = {
  total: number;
  /** status_category buckets across ALL tickets (current state of the whole desk) */
  open: number; paused: number; resolved: number; other: number;
  /** over the trend window (trailing 30 days when no dates are passed) */
  windowDays: number; created: number; resolvedInWindow: number; net: number; weeks: HdWeek[];
  slaPct: number | null; firstResponseHours: number | null; resolutionDays: number | null;
  csat: number | null; csatCount: number;
};

export function hdKpis(o: HdOverview): HdKpis {
  const cat = o.by_status_category ?? {};
  const total = num(o.total);
  const open = num(cat.Open), paused = num(cat.Paused), resolved = num(cat.Resolved);
  const trend = Array.isArray(o.trend) ? o.trend : [];
  const created = sumBy(trend, (r) => r.created);
  const resolvedInWindow = sumBy(trend, (r) => r.resolved);
  const opt = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return {
    total, open, paused, resolved,
    other: Math.max(0, total - open - paused - resolved),
    windowDays: trend.length, created, resolvedInWindow, net: created - resolvedInWindow, weeks: weeklyBuckets(trend),
    slaPct: opt(o.sla_fulfilled_pct), firstResponseHours: opt(o.avg_first_response_hours), resolutionDays: opt(o.avg_resolution_days),
    csat: opt(o.avg_feedback_rating), csatCount: num(o.feedback_count),
  };
}

/** SLA-fulfilled bands — identical cut-offs to the Help Desk page's compliance gauge. */
export type SlaBand = 'excellent' | 'healthy' | 'at_risk' | 'breaching';
export const slaBand = (pct: number): SlaBand => (pct >= 90 ? 'excellent' : pct >= 75 ? 'healthy' : pct >= 50 ? 'at_risk' : 'breaching');

/** Hours → "45m" / "3.2h" / "1.4d" (same rule as helpdesk/_dash.tsx fmtH). */
export const fmtHours = (h: number | null | undefined): string =>
  h == null ? '—' : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
export const fmtDays = (d: number | null | undefined): string => (d == null ? '—' : `${d.toFixed(d < 10 ? 1 : 0)}d`);

/* =====================================================================================
   PCI compliance — composed from three EXISTING endpoints (no new backend):
     GET /assets?limit=…                                 → cde_environment (PCI scope flag)
     GET /compliance-plugins/assets-overview             → per-asset CIS pass_rate / scanned_rules
     GET /vuln-management/dashboard/asset-risk-heatmap   → per-asset open crit/high + KEV counts
   ===================================================================================== */

/** The CIS pass rate an in-scope asset must reach (the CIS page's own green threshold). */
export const PCI_CIS_THRESHOLD = 80;
/** asset-risk-heatmap hard-caps its response at 200 assets (min(limit, 200) server-side). */
export const PCI_VULN_CAP = 200;

export type PciAssetInput = {
  id: number; name: string;
  host_name?: string | null; ip_address?: string | null; criticality?: string | null;
  cde_environment?: boolean | null;
};
export type CisAssetRow = {
  id: number;
  scanned_rules?: number | null; passed?: number | null; failed?: number | null;
  /** passed ÷ applicable rules (coverage-adjusted) — the number the CIS pages show. */
  pass_rate?: number | null; last_scan_at?: string | null;
};
export type CisAssetsOverview = { groups?: { assets?: CisAssetRow[] }[] };
export type HeatRow = {
  asset_id: number;
  open_vuln_count?: number; kev_count?: number;
  severity_breakdown?: Partial<Record<'critical' | 'high' | 'medium' | 'low' | 'info', number>>;
};
export type VulnHeatmap = { assets?: HeatRow[] };

export type PciReason = 'crit_high' | 'kev' | 'cis_low' | 'cis_unscanned' | 'vuln_unverified';
export const PCI_REASONS: PciReason[] = ['crit_high', 'kev', 'cis_low', 'cis_unscanned', 'vuln_unverified'];

export type PciAssetState = {
  id: number; name: string; criticality: string | null; ip: string | null;
  cisScanned: boolean; cisPassRate: number | null;
  critical: number; high: number; kev: number; openVulns: number;
  /** false → heatmap was truncated and the asset is absent: its vulnerabilities are NOT known to be clean */
  vulnKnown: boolean;
  compliant: boolean; reasons: PciReason[];
};
export type PciSummary = {
  total: number; compliant: number; atRisk: number;
  /** compliant ÷ total, rounded; null with no PCI-scope assets */
  compliancePct: number | null;
  /** # of at-risk assets carrying each reason (an asset can carry several) */
  reasons: Record<PciReason, number>;
  cisScanned: number;
  vulnTruncated: boolean;
  /** at-risk assets, worst first */
  worst: PciAssetState[];
  threshold: number;
};

export const EMPTY_PCI: PciSummary = {
  total: 0, compliant: 0, atRisk: 0, compliancePct: null,
  reasons: { crit_high: 0, kev: 0, cis_low: 0, cis_unscanned: 0, vuln_unverified: 0 },
  cisScanned: 0, vulnTruncated: false, worst: [], threshold: PCI_CIS_THRESHOLD,
};

/** Worse = higher. KEV beats critical beats high beats CIS gap; "never scanned" counts as the full gap. */
const worstKey = (a: PciAssetState): number =>
  a.kev * 1_000_000 + a.critical * 10_000 + a.high * 100 + (a.cisScanned ? Math.max(0, 100 - (a.cisPassRate ?? 0)) : 100) + (a.vulnKnown ? 0 : 50);

/**
 * "PCI compliant" = asset flagged cde_environment AND CIS pass rate ≥ threshold AND no open
 * Critical/High vulnerability AND no open CISA-KEV vulnerability. Everything else in scope is
 * "at risk". Absence of evidence is not compliance, so an asset with no CIS scan — or whose
 * vulnerabilities could not be verified because the heatmap was cut at its 200-asset cap — can
 * never be compliant.
 */
export function derivePci(
  assets: PciAssetInput[] | null | undefined,
  cis: CisAssetsOverview | null | undefined,
  heat: VulnHeatmap | null | undefined,
  threshold: number = PCI_CIS_THRESHOLD,
): PciSummary {
  const scope = (Array.isArray(assets) ? assets : []).filter((a) => a && a.cde_environment === true);
  if (!scope.length) return { ...EMPTY_PCI, reasons: { ...EMPTY_PCI.reasons }, threshold };

  const cisById = new Map<number, CisAssetRow>();
  for (const g of cis?.groups ?? []) for (const r of g?.assets ?? []) if (r) cisById.set(r.id, r);

  const heatRows = Array.isArray(heat?.assets) ? (heat!.assets as HeatRow[]) : [];
  const heatById = new Map<number, HeatRow>();
  for (const r of heatRows) if (r) heatById.set(r.asset_id, r);
  const truncated = heatRows.length >= PCI_VULN_CAP;

  const states: PciAssetState[] = scope.map((a) => {
    const c = cisById.get(a.id);
    const rate = c?.pass_rate;
    const cisScanned = !!c && num(c.scanned_rules) > 0 && typeof rate === 'number' && Number.isFinite(rate);
    const h = heatById.get(a.id);
    const vulnKnown = !!h || !truncated;
    const critical = num(h?.severity_breakdown?.critical);
    const high = num(h?.severity_breakdown?.high);
    const kev = num(h?.kev_count);

    const reasons: PciReason[] = [];
    if (critical + high > 0) reasons.push('crit_high');
    if (kev > 0) reasons.push('kev');
    if (!cisScanned) reasons.push('cis_unscanned');
    else if ((rate as number) < threshold) reasons.push('cis_low');
    if (!vulnKnown) reasons.push('vuln_unverified');

    return {
      id: a.id,
      name: a.name || a.host_name || a.ip_address || `Asset ${a.id}`,
      criticality: a.criticality ?? null,
      ip: a.ip_address ?? null,
      cisScanned,
      cisPassRate: cisScanned ? (rate as number) : null,
      critical, high, kev, openVulns: num(h?.open_vuln_count),
      vulnKnown,
      compliant: reasons.length === 0,
      reasons,
    };
  });

  const total = states.length;
  const compliant = states.filter((s) => s.compliant).length;
  const reasons = { ...EMPTY_PCI.reasons };
  for (const s of states) for (const r of s.reasons) reasons[r] += 1;

  return {
    total, compliant, atRisk: total - compliant,
    compliancePct: Math.round((compliant / total) * 100),
    reasons,
    cisScanned: states.filter((s) => s.cisScanned).length,
    vulnTruncated: truncated,
    worst: states.filter((s) => !s.compliant).sort((a, b) => worstKey(b) - worstKey(a) || a.name.localeCompare(b.name)),
    threshold,
  };
}
