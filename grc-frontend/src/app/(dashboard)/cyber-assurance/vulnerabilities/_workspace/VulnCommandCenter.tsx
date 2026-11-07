'use client';

/**
 * VulnCommandCenter — the Vulnerabilities "Overview" surface.
 *
 * Executive-grade, insight-led. This tenant's findings carry strong, POPULATED
 * signal in a few dimensions (severity, linked assets, finding type/domain,
 * contextual priority, internet exposure, discovery age, status/lifecycle) and
 * almost NO signal in others (KEV, EPSS, public-exploit, SLA on-time, MTTR —
 * threat-intel enrichment hasn't run). Every panel leads with a populated number
 * turned into a business "so what" (exposure, blast radius, what to fix first and
 * why), then renders it with a premium ComplyVerse-themed chart — a recharts donut for
 * severity, gradient tracked bars for priority & finding-type, a heat grid for
 * severity×criticality, a treemap for host blast-radius, a segmented pipeline for
 * the remediation lifecycle. The empty-now-but-real-later signals fold into ONE
 * honest, minimized "not scored yet" strip — never a big blank card.
 *
 * Data (all real, all frontend-only — no new backend):
 *   • `dashboard`  — server rollup over the WHOLE register.
 *   • `vulns`      — the register; the open subset drives the composition panels.
 *   • getThreatIntel / getAssetRiskHeatmap / getDomains — cached server aggregates
 *     the client can't cheaply derive (criticality×severity matrix, per-asset
 *     summed priority, de-branded finding-type families).
 *
 * ComplyVerse tokens only: #005B96 accent, light theme, grey canvas + white cards,
 * Poppins (inherited), soft shadows. Recharts marks are themed to the ComplyVerse
 * palette (severity semantics / accent), never a default multicolour ramp.
 * Distinct from the Performance dashboard (risk gauge + lenses) and the Asset
 * Inventory Overview. The shell <main> is the scroller — the root stays
 * natural-height + overflowX:hidden (no inner scroll container).
 */

import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Flame, Globe, Server, Clock3, GitBranch,
  ShieldAlert, ShieldCheck, ArrowRight, FileWarning, Crosshair, Layers, X,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList,
  ResponsiveContainer,
} from 'recharts';
import { vulnManagementApi } from '@/cyber-assurance/lib/api';
import { shortenVulnTitle, deBrandDomain, type Vulnerability } from './lib';

// ── ComplyVerse palette (literal, matching the workspace) ──
const AC = '#005B96', ACS = '#014A81', ACSOFT = '#EFF5FA';
// MUTED/FAINT darkened from #8A95A1/#AEB8C2 → legible on white (≈5.3:1 / ≈3.7:1,
// was ≈3.1:1 / ≈2.0:1) while keeping the hierarchy INK > SEC > MUTED > FAINT.
const INK = '#0F1F2B', SEC = '#3A4653', MUTED = '#616C7A', FAINT = '#7B8795';
const BORDER = '#E8ECEE', BORDER2 = '#F0F3F5';
const MONO = 'ui-monospace,Consolas,monospace';
const TNUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

// Severity tones — Info stays a calm grey so the real heat (crit/high) reads
// against a quiet majority instead of a wall of colour.
const SEV = {
  critical: { c: '#C2453F', label: 'Critical' },
  high: { c: '#C0682F', label: 'High' },
  medium: { c: '#E0AF33', label: 'Medium' },
  low: { c: '#1F7A54', label: 'Low' },
  info: { c: '#AEB8C2', label: 'Info' },
} as const;
type SevKey = keyof typeof SEV;
const SEV_ORDER: SevKey[] = ['critical', 'high', 'medium', 'low', 'info'];
const SEV_RANK: Record<SevKey, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const EXPOSED_TONE = '#7A5AC9';

// Status — ComplyVerse-mapped (not a stock multicolour ramp).
const STATUS: Record<string, { c: string; label: string }> = {
  open: { c: '#C2453F', label: 'Open' },
  in_progress: { c: '#E0AF33', label: 'In progress' },
  remediated: { c: '#4C7A9C', label: 'Remediated' },
  verified: { c: '#1F7A54', label: 'Verified' },
  closed: { c: '#AEB8C2', label: 'Closed' },
  accepted: { c: '#7A5AC9', label: 'Risk accepted' },
  false_positive: { c: '#CBD3DA', label: 'False positive' },
  auto_closed_fixed: { c: '#2E8B6B', label: 'Closed · verified' },
  auto_closed_decommissioned: { c: '#AEB8C2', label: 'Closed · retired' },
};
const RESOLVED = new Set(['resolved', 'remediated', 'verified', 'closed', 'accepted', 'false_positive', 'auto_closed_decommissioned', 'auto_closed_fixed']);
const CLOSED_LIKE = new Set(['remediated', 'verified', 'closed', 'accepted', 'false_positive', 'auto_closed_decommissioned', 'auto_closed_fixed']);

// Contextual-priority tiers (composite_priority is 0–10; shown ×10 → 0–100).
const PRIO: { k: 'critical' | 'high' | 'medium' | 'low' | 'unscored'; label: string; c: string; hint: string }[] = [
  { k: 'critical', label: 'Critical', c: '#C2453F', hint: '≥90' },
  { k: 'high', label: 'High', c: '#C0682F', hint: '70–89' },
  { k: 'medium', label: 'Medium', c: '#E0AF33', hint: '40–69' },
  { k: 'low', label: 'Low', c: '#1F7A54', hint: '<40' },
  { k: 'unscored', label: 'Unscored', c: '#CBD3DA', hint: 'not yet' },
];

const AGING_ORDER = ['0-7 days', '8-30 days', '31-90 days', '90+ days'];
const AGING_LABEL: Record<string, string> = { '0-7 days': '0–7d', '8-30 days': '8–30d', '31-90 days': '31–90d', '90+ days': '90d+' };
const AGING_COLOR = ['#1F7A54', '#E0AF33', '#C0682F', '#C2453F'];
const AGE_GRAD = ['sgv-low', 'sgv-medium', 'sgv-high', 'sgv-critical'];

const normSev = (s?: string): SevKey => { const k = (s || '').toLowerCase(); return (k in SEV ? k : k === 'informational' ? 'info' : 'info') as SevKey; };
const worseSev = (a: string | undefined, b: string | undefined): SevKey => (SEV_RANK[normSev(a)] >= SEV_RANK[normSev(b)] ? normSev(a) : normSev(b));
const hasExploit = (v: Vulnerability) => (v.public_exploit_count ?? 0) > 0 || (v.exploitdb_count ?? 0) > 0 || !!v.kev_flag;
const isExposed = (v: Vulnerability) => !!v.internet_facing || !!v.internet_exposed;
const ctx = (v: Vulnerability) => (v.composite_priority == null ? null : Math.round(v.composite_priority * 10));
const prioTier = (v: Vulnerability): typeof PRIO[number]['k'] => {
  const s = ctx(v);
  if (s == null) return 'unscored';
  return s >= 90 ? 'critical' : s >= 70 ? 'high' : s >= 40 ? 'medium' : 'low';
};
const ageDays = (v: Vulnerability) => { const b = v.discovered_at || v.created_at; return b ? Math.floor((Date.now() - new Date(b).getTime()) / 864e5) : null; };
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
// Why-fix-this drivers — turns the action queue from a list into "fix BECAUSE".
const drivers = (v: Vulnerability): { t: string; c: string }[] => {
  const out: { t: string; c: string }[] = [];
  if (v.kev_flag) out.push({ t: 'KEV', c: '#C2453F' });
  if ((v.public_exploit_count ?? 0) > 0 || (v.exploitdb_count ?? 0) > 0) out.push({ t: 'Public exploit', c: '#C0682F' });
  if (isExposed(v)) out.push({ t: 'Internet-facing', c: EXPOSED_TONE });
  if ((v.cvss_score ?? 0) >= 9) out.push({ t: `CVSS ${(v.cvss_score as number).toFixed(1)}`, c: '#9A6410' });
  return out;
};

// ── server aggregate shapes (reused from the standalone dashboard) ──
interface ThreatIntel {
  kev_exposure?: { kev: number; non_kev: number };
  priority_buckets?: { critical: number; high: number; medium: number; low: number; unscored: number };
  epss_bands?: { very_high: number; high: number; moderate: number; low: number; negligible: number; unscored: number };
  asset_criticality_matrix?: Array<{ asset_criticality: string; critical: number; high: number; medium: number; low: number; info: number }>;
  enrichment_coverage?: { total_open: number; enriched: number; kev_count: number; epss_count: number };
}
interface HeatmapRow { asset_id: number; asset_name: string; criticality?: string | null; open_vuln_count: number; kev_count: number; total_priority_sum: number; }
interface Heatmap { assets?: HeatmapRow[]; summary?: { total_assets: number; total_open_vulns: number }; }
interface DomainRow { family: string; total: number; worst_severity: string; }

// Richer than the component strictly needs; every field optional so the
// narrower `dashboard` passed by the workspace stays structurally assignable.
interface OverviewDashboard {
  total_vulnerabilities?: number;
  open_vulnerabilities?: number;              // deduped-distinct OPEN count (shared metric)
  by_severity?: Record<string, number>;
  by_status?: Record<string, number>;
  contextual_priority?: { urgent?: number; moderate?: number; low?: number };
  aging_buckets?: Record<string, number>;
  internet_exposed_count?: number;
  with_cve_count?: number;
  no_exploit_count?: number;
  patch_count?: number;
  mitigation_coverage?: { with_mitigations?: number; without_mitigations?: number };
  top_affected_assets?: Array<{ asset_id: number; asset_name: string; vulnerability_count: number }>;
  kev_count?: number;
  exploit_count?: number;
  high_epss_count?: number;
  overdue_count?: number;
  mttr_days?: number | null;
  sla_compliance?: Record<string, { compliance_rate?: number }>;
}

// ── shared style atoms ──
// Cards are flex columns so, inside the stretch-equal rows, their main content block can grow
// with flex:1 to fill the shared height — no big blank bottoms, both cards in a row aligned.
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.05), 0 8px 22px -14px rgba(16,24,40,.16)', display: 'flex', flexDirection: 'column' };
const cap: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: FAINT };
// Flex rows with flex-grow children → a wrapped card always fills its row.
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 };

export default function VulnCommandCenter({
  vulns, dashboard, onView,
}: {
  vulns: Vulnerability[];
  dashboard?: OverviewDashboard;
  onView: (v: Vulnerability) => void;
}) {
  // Server aggregates the client can't cheaply derive (cached shared keys).
  const { data: threat } = useQuery({ queryKey: ['vuln-threat-intel'], queryFn: async () => (await vulnManagementApi.dashboard.getThreatIntel()).data as ThreatIntel, staleTime: 60_000 });
  const { data: heatmap } = useQuery({ queryKey: ['vuln-asset-heatmap'], queryFn: async () => (await vulnManagementApi.dashboard.getAssetRiskHeatmap()).data as Heatmap, staleTime: 60_000 });
  // Reuses the page's existing ['vuln-domains'] query key → shared cache, no extra request.
  const { data: domainsResp } = useQuery({ queryKey: ['vuln-domains'], queryFn: async () => (await vulnManagementApi.vulnerabilities.getDomains()).data as { domains?: DomainRow[] }, staleTime: 60_000 });

  const m = useMemo(() => {
    const all = vulns || [];
    const open = all.filter((v) => !RESOLVED.has((v.status || '').toLowerCase()));
    // The headline "Open" count is the DEDUPED-distinct open number (shared distinct_vuln_count),
    // so it reconciles with the IT Asset Inventory and AI Pentest surfaces — not the raw register list.
    // `open` (the raw-list array) still drives the severity composition breakdown below.
    const totalOpen = dashboard?.open_vulnerabilities ?? open.length;

    // ── Severity composition of open findings (the lead story) ──
    const sevDist = SEV_ORDER.map((k) => ({ k, label: SEV[k].label, c: SEV[k].c, n: open.filter((v) => normSev(v.severity) === k).length }));
    const critHigh = sevDist[0].n + sevDist[1].n;
    const sevMax = Math.max(1, ...sevDist.map((x) => x.n));

    // ── Populated headline stats (all server/real, never dashes) ──
    const exposed = dashboard?.internet_exposed_count ?? open.filter(isExposed).length;
    const withCve = dashboard?.with_cve_count ?? open.filter((v) => !!v.cve_id).length;
    const distinctAssets = heatmap?.summary?.total_assets ?? new Set(open.flatMap((v) => v.linked_assets ?? [])).size;
    // The "wow" exposure stat — what an adversary reaches first.
    const exposedCritHigh = open.filter((v) => isExposed(v) && (normSev(v.severity) === 'critical' || normSev(v.severity) === 'high')).length;

    // ── Contextual priority tiers ──
    const pbServer = threat?.priority_buckets;
    const prio = PRIO.map((p) => ({
      ...p,
      n: pbServer?.[p.k] ?? open.filter((v) => prioTier(v) === p.k).length,
    }));
    const prioMax = Math.max(1, ...prio.map((p) => p.n));
    const prioActionable = prio[0].n + prio[1].n; // critical + high (contextual)

    // ── Finding type / domain (server-accurate, de-branded) ──
    const rawDomains = domainsResp?.domains ?? [];
    const domMap = new Map<string, { n: number; sev: SevKey }>();
    if (rawDomains.length) {
      for (const d of rawDomains) {
        const label = deBrandDomain(d.family);
        const cur = domMap.get(label);
        domMap.set(label, { n: (cur?.n ?? 0) + (d.total ?? 0), sev: cur ? worseSev(cur.sev, d.worst_severity) : normSev(d.worst_severity) });
      }
    } else {
      // Fallback: group the open set by de-branded plugin family.
      for (const v of open) {
        const label = deBrandDomain(v.plugin_family);
        const cur = domMap.get(label);
        domMap.set(label, { n: (cur?.n ?? 0) + 1, sev: cur ? worseSev(cur.sev, v.severity) : normSev(v.severity) });
      }
    }
    const domains = [...domMap.entries()].map(([label, x]) => ({ label, n: x.n, sev: x.sev, c: SEV[x.sev].c })).sort((a, b) => b.n - a.n).slice(0, 7);
    const domainMax = Math.max(1, ...domains.map((d) => d.n));
    const domainTotal = domains.reduce((s, d) => s + d.n, 0);

    // ── Asset blast radius / choke-points (server heatmap, else dashboard) ──
    let assetRows: HeatmapRow[] = heatmap?.assets ?? [];
    if (!assetRows.length && dashboard?.top_affected_assets?.length) {
      assetRows = dashboard.top_affected_assets.map((a) => ({ asset_id: a.asset_id, asset_name: a.asset_name, criticality: null, open_vuln_count: a.vulnerability_count, kev_count: 0, total_priority_sum: 0 }));
    }
    const topAssets = [...assetRows].sort((a, b) => (b.open_vuln_count - a.open_vuln_count) || (b.total_priority_sum - a.total_priority_sum)).slice(0, 10);
    const assetOpenTotal = heatmap?.summary?.total_open_vulns ?? assetRows.reduce((s, a) => s + a.open_vuln_count, 0);
    const topShare = pct(topAssets.reduce((s, a) => s + a.open_vuln_count, 0), assetOpenTotal);
    const assetMax = Math.max(1, ...topAssets.map((a) => a.open_vuln_count));
    const top1 = topAssets[0];

    // ── Per-asset OPEN findings (drives the treemap drill-down popup) ──
    // Groups the register's open set by linked asset (else affected_host), keyed
    // on a normalised name so a server asset_name and a finding's linked_assets
    // entry still match across case / whitespace drift.
    const assetVulnMap = new Map<string, Vulnerability[]>();
    for (const v of open) {
      const names = v.linked_assets?.length ? v.linked_assets : (v.affected_host ? [v.affected_host] : []);
      for (const raw of names) {
        const name = (raw || '').trim();
        if (!name) continue;
        const k = name.toLowerCase();
        const arr = assetVulnMap.get(k);
        if (arr) arr.push(v); else assetVulnMap.set(k, [v]);
      }
    }

    // ── Severity × asset-criticality heat grid (server) ──
    const matrix = (threat?.asset_criticality_matrix ?? []).filter((r) => (r.critical + r.high + r.medium + r.low + r.info) > 0);
    const matrixMax = Math.max(1, ...matrix.flatMap((r) => [r.critical, r.high, r.medium, r.low, r.info]));
    // The danger corner: Critical/High findings landing on business-critical assets.
    const dangerCorner = matrix.filter((r) => { const c = (r.asset_criticality || '').toLowerCase(); return c === 'critical' || c === 'high'; }).reduce((s, r) => s + r.critical + r.high, 0);

    // ── Discovery-age backlog (server aging_buckets, else client) ──
    const agingSrc = dashboard?.aging_buckets && Object.keys(dashboard.aging_buckets).length ? dashboard.aging_buckets : null;
    const aging = AGING_ORDER.map((key, i) => {
      let n: number;
      if (agingSrc) n = agingSrc[key] ?? 0;
      else n = open.filter((v) => { const d = ageDays(v); if (d == null) return false; return key === '0-7 days' ? d <= 7 : key === '8-30 days' ? d > 7 && d <= 30 : key === '31-90 days' ? d > 30 && d <= 90 : d > 90; }).length;
      return { label: AGING_LABEL[key], n, c: AGING_COLOR[i] };
    });
    const stubborn = aging[3].n; // 90d+
    const fresh = aging[0].n; // 0–7d

    // ── Remediation posture — full lifecycle (server by_status over ALL) ──
    const byStatusRaw = dashboard?.by_status ?? all.reduce<Record<string, number>>((a, v) => { const s = (v.status || 'open').toLowerCase(); a[s] = (a[s] || 0) + 1; return a; }, {});
    const statusDist = Object.entries(byStatusRaw).filter(([, n]) => n > 0).map(([k, n]) => ({ k, n, c: STATUS[k]?.c || '#CBD3DA', label: STATUS[k]?.label || k.replace(/_/g, ' ') })).sort((a, b) => b.n - a.n);
    const statusTotal = statusDist.reduce((s, x) => s + x.n, 0);
    const registerTotal = dashboard?.total_vulnerabilities ?? (statusTotal || all.length);
    const closedCount = Object.entries(byStatusRaw).reduce((s, [k, n]) => s + (CLOSED_LIKE.has(k) ? n : 0), 0);
    const fixAvailable = dashboard?.patch_count ?? open.filter((v) => Array.isArray(v.patch_references) && v.patch_references.length > 0).length;
    const mitigated = dashboard?.mitigation_coverage?.with_mitigations ?? 0;

    // ── Fix-first — top open by contextual priority ──
    const fixFirst = [...open].sort((a, b) => (ctx(b) ?? -1) - (ctx(a) ?? -1)).slice(0, 8);

    // ── Honest "not scored yet" threat-intel signals ──
    const ec = threat?.enrichment_coverage;
    const kev = dashboard?.kev_count ?? threat?.kev_exposure?.kev ?? open.filter((v) => !!v.kev_flag).length;
    const publicExploit = dashboard?.exploit_count ?? open.filter(hasExploit).length;
    const epssScored = ec?.epss_count ?? dashboard?.high_epss_count ?? 0;
    const overdue = dashboard?.overdue_count ?? 0;
    const mttr = dashboard?.mttr_days ?? null;
    const slaRates = dashboard?.sla_compliance ? Object.values(dashboard.sla_compliance).map((x) => x.compliance_rate ?? 0).filter((r) => r > 0) : [];
    const slaPct = slaRates.length ? Math.round(slaRates.reduce((s, r) => s + r, 0) / slaRates.length) : null;
    const enriched = ec?.enriched ?? 0;
    const enrichBase = ec?.total_open ?? totalOpen;

    // ── chart-ready arrays (memoised → stable identity, no re-animation) ──
    const sevSlices = sevDist.map((d) => ({ k: d.k, label: d.label, c: d.c, n: d.n }));
    const prioRows = prio.map((p) => ({ label: p.label, n: p.n, c: p.c, grad: `url(#sgv-${p.k})`, hint: p.hint }));
    const typeRows = domains.map((d) => ({ label: d.label, n: d.n, c: d.c, grad: `url(#sgv-${d.sev})` }));
    const ageRows = aging.map((a, i) => ({ label: a.label, n: a.n, c: a.c, grad: `url(#${AGE_GRAD[i]})` }));
    const treeData = topAssets.map((a) => ({ name: a.asset_name, size: Math.max(0, a.open_vuln_count), kev: a.kev_count, crit: a.criticality ?? null }));

    return {
      totalOpen, registerTotal, sevDist, sevMax, sevSlices, critHigh, exposed, withCve, distinctAssets, exposedCritHigh,
      prio, prioMax, prioActionable, prioRows, domains, domainMax, domainTotal, typeRows,
      topAssets, topShare, assetMax, assetOpenTotal, top1, treeData, matrix, matrixMax, dangerCorner,
      aging, ageRows, stubborn, fresh, statusDist, statusTotal, closedCount, fixAvailable, mitigated,
      fixFirst, kev, publicExploit, epssScored, overdue, mttr, slaPct, enriched, enrichBase,
      assetVulnMap,
    };
  }, [vulns, dashboard, threat, heatmap, domainsResp]);

  const barW = (n: number, max: number) => `${max ? Math.max(n > 0 ? 5 : 0, (n / max) * 100) : 0}%`;
  const closedPct = pct(m.closedCount, m.registerTotal);

  // Blast-radius drill-down: which host's findings to show in the popup (null = closed).
  const [assetModal, setAssetModal] = useState<string | null>(null);

  // Headline chips — every one is a populated, high-signal number.
  const chips: { label: string; value: number; sub: string; Icon: typeof Flame; tone: string }[] = [
    { label: 'Critical + High', value: m.critHigh, sub: `${pct(m.critHigh, m.totalOpen)}% of what's open`, Icon: Flame, tone: m.critHigh ? '#C0682F' : INK },
    { label: 'Internet-reachable', value: m.exposed, sub: `${m.exposedCritHigh} of them Critical/High`, Icon: Globe, tone: m.exposed ? EXPOSED_TONE : INK },
    { label: 'Hosts affected', value: m.distinctAssets, sub: 'carrying ≥1 open finding', Icon: Server, tone: INK },
    { label: 'Carry a CVE', value: m.withCve, sub: 'externally catalogued', Icon: FileWarning, tone: INK },
  ];

  // Threat-intel / SLA coverage figures — populated or honest, for the signal-coverage card.
  const covStats: { label: string; value: number | string; tone: string }[] = [
    { label: 'KEV CVEs', value: m.kev, tone: m.kev ? '#C2453F' : FAINT },
    { label: 'Public exploit', value: m.publicExploit, tone: m.publicExploit ? '#C0682F' : FAINT },
    { label: 'Probability-scored', value: m.epssScored, tone: m.epssScored ? AC : FAINT },
    { label: 'Overdue', value: m.overdue, tone: m.overdue ? '#C2453F' : FAINT },
    { label: 'SLA on-time', value: m.slaPct == null ? '—' : `${m.slaPct}%`, tone: FAINT },
    { label: 'MTTR', value: m.mttr == null ? '—' : `${m.mttr}d`, tone: FAINT },
  ];

  return (
    <div style={{ overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 12, color: INK, fontSize: 13.5, paddingBottom: 18 }}>

      {/* document-global SVG gradient defs — referenced by id from every recharts mark */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          {SEV_ORDER.map((k) => (
            <linearGradient key={k} id={`sgv-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SEV[k].c} stopOpacity={0.72} />
              <stop offset="100%" stopColor={SEV[k].c} stopOpacity={1} />
            </linearGradient>
          ))}
          <linearGradient id="sgv-unscored" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#CBD3DA" stopOpacity={0.7} />
            <stop offset="100%" stopColor="#B4BEC8" stopOpacity={1} />
          </linearGradient>
        </defs>
      </svg>

      {/* ══ TOP STRIP — thin executive summary (the ONE allowed full-width element) ══ */}
      <section style={{ ...card, padding: '11px 16px', background: 'linear-gradient(180deg,#FFFFFF 0%, #FBFDFE 100%)', borderLeft: `3px solid ${AC}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: `${AC}14`, color: ACS, display: 'grid', placeItems: 'center', flex: 'none' }}><Activity size={16} /></span>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <span style={cap}>Open security posture</span>
            <p style={{ fontSize: 12.5, color: SEC, lineHeight: 1.5, margin: '2px 0 0' }}>
              {m.totalOpen === 0 ? 'No open findings in the register — the backlog is clear.' : <>
                <b style={{ color: INK }}>{m.critHigh}</b> of {m.totalOpen} open findings are <b style={{ color: '#C0682F' }}>Critical or High</b>, concentrated on <b style={{ color: INK }}>{m.distinctAssets}</b> host{m.distinctAssets === 1 ? '' : 's'}.{m.exposedCritHigh > 0 ? <> <b style={{ color: EXPOSED_TONE }}>{m.exposedCritHigh}</b> of them are reachable from the internet — the surface an adversary reaches first.</> : m.exposed > 0 ? <> <b style={{ color: EXPOSED_TONE }}>{m.exposed}</b> sit on internet-facing hosts.</> : ''}
              </>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <MiniStat label="In register" value={m.registerTotal} tone={INK} />
            <MiniStat label="Open" value={m.totalOpen} tone={m.totalOpen ? '#C0682F' : INK} />
            <MiniStat label="Resolved" value={`${closedPct}%`} tone="#1F7A54" />
          </div>
        </div>
      </section>

      {/* ══ ROW 1 — open by severity · exposure & reach ══ */}
      <div style={row}>
        <section style={{ ...card, padding: '15px 17px', flex: '1 1 340px', minWidth: 0 }}>
          <CardHead title="Open by severity" sub="the register's severity mix" Icon={Activity} />
          <Insight>{m.critHigh > 0
            ? <><b style={{ color: '#C0682F' }}>{m.critHigh}</b> of {m.totalOpen} open ({pct(m.critHigh, m.totalOpen)}%) are Critical/High; the remainder is lower-severity noise that can wait.</>
            : <>No Critical or High findings are open — the mix is entirely lower-severity.</>}</Insight>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', justifyContent: 'center', marginTop: 12, flex: 1 }}>
            {/* premium recharts donut + centred total */}
            <SeverityDonut data={m.sevSlices} total={m.totalOpen} />
            {/* severity composition — the distribution, spelled out */}
            <div style={{ flex: '1 1 190px', minWidth: 0 }}>
              <span style={cap}>Severity composition</span>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {m.sevDist.map((d) => (
                  <div key={d.k} style={{ display: 'grid', gridTemplateColumns: '62px minmax(0,1fr) 56px', gap: 9, alignItems: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: SEC }}><span style={{ width: 9, height: 9, borderRadius: 3, background: d.c, flex: 'none' }} />{d.label}</span>
                    <span style={{ height: 8, background: '#EFF2F4', borderRadius: 5, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: barW(d.n, m.sevMax), background: `linear-gradient(90deg, ${d.c}C0, ${d.c})`, borderRadius: 5 }} /></span>
                    <span style={{ textAlign: 'right', fontSize: 11, color: MUTED, ...TNUM }}><b style={{ color: INK }}>{d.n}</b> · {pct(d.n, m.totalOpen)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...card, padding: '15px 17px', flex: '1 1 340px', minWidth: 0 }}>
          <CardHead title="Exposure & reach" sub="what an adversary can touch first" Icon={Globe} />
          <Insight>{m.exposed > 0
            ? <><b style={{ color: EXPOSED_TONE }}>{m.exposed}</b> open finding{m.exposed === 1 ? '' : 's'} sit on internet-facing hosts{m.exposedCritHigh > 0 ? <>, <b style={{ color: '#C0682F' }}>{m.exposedCritHigh}</b> of them Critical/High — the first surface an attacker reaches</> : ''}.</>
            : <>Nothing open is internet-facing — exposure is contained to internal hosts.</>}</Insight>
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, flex: 1, gridAutoRows: 'minmax(0, 1fr)' }}>
            {chips.map((c) => {
              const tone = c.tone === INK ? AC : c.tone;
              return (
                <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${BORDER2}`, borderRadius: 12, padding: '9px 11px', background: '#fff', minWidth: 0, boxShadow: '0 1px 2px rgba(16,24,40,.03)' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, background: `${tone}14`, color: tone, display: 'grid', placeItems: 'center', flex: 'none' }}><c.Icon size={16} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c.tone, lineHeight: 1.12, ...TNUM }}>{c.value}</div>
                    <div style={{ fontSize: 10, color: FAINT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ══ contextual priority triage + finding types ══ */}
      <div style={row}>
        <section style={{ ...card, padding: '15px 17px', flex: '1 1 340px', minWidth: 0 }}>
          <CardHead title="Contextual priority" sub="CVSS re-weighted by exploit, exposure & asset value" Icon={Crosshair} />
          <Insight>{m.prioActionable > 0
            ? <>Raw severity flags <b>{m.critHigh}</b> findings urgent; once exploitability, exposure and asset value are folded in, the real work queue is <b style={{ color: '#C0682F' }}>{m.prioActionable}</b> Critical/High — chase these, not the raw count.</>
            : <>Context pulls almost everything to the lower tiers once exposure and asset value are weighed — little is genuinely urgent.</>}</Insight>
          {m.prioMax <= 0 ? <Empty>No findings to prioritise.</Empty> : <HBars rows={m.prioRows} labelWidth={78} height={m.prioRows.length * 30 + 14} />}
          <p style={{ fontSize: 10, color: FAINT, marginTop: 9 }}>Tiers (score /100): Critical ≥90 · High 70–89 · Medium 40–69 · Low &lt;40 · Unscored — enrichment pending.</p>
        </section>

        <section style={{ ...card, padding: '15px 17px', flex: '1 1 340px', minWidth: 0 }}>
          <CardHead title="Finding types" sub="what kind of weakness, by domain" Icon={Layers} />
          {m.domains.length === 0 ? <Empty>No open findings to categorise.</Empty> : (
            <>
              <Insight>{m.domains[0] && <><b>{m.domains[0].label}</b> is the dominant class ({m.domains[0].n}{m.domainTotal ? `, ${pct(m.domains[0].n, m.domainTotal)}%` : ''}){m.domains[1] ? <>, then {m.domains[1].label} ({m.domains[1].n})</> : ''} — a concentrated class means one patch wave or control clears many findings at once.</>}</Insight>
              <HBars rows={m.typeRows} labelWidth={128} height={m.typeRows.length * 30 + 14} />
              <p style={{ fontSize: 10, color: FAINT, marginTop: 9 }}>Bar colour = the worst severity seen in that class.</p>
            </>
          )}
        </section>
      </div>

      {/* ══ ROW 3 — where the risk concentrates · severity × criticality ══ */}
      <div style={row}>
        <section style={{ ...card, padding: '15px 17px', flex: '1 1 360px', minWidth: 0 }}>
          <CardHead title="Where the risk concentrates" sub="open findings by host — the blast radius" Icon={Server} />
          {m.topAssets.length === 0 ? <Empty>No findings are linked to an asset yet — link assets to map blast radius.</Empty> : (
            <>
              <Insight>{m.topShare > 0
                ? <>The top {m.topAssets.length} host{m.topAssets.length === 1 ? '' : 's'} carry <b>{m.topShare}%</b> of every open finding{m.top1 ? <>, and <b>{m.top1.asset_name}</b> alone holds <b>{m.top1.open_vuln_count}</b></> : ''} — remediating this short list clears most of the backlog in a handful of actions.</>
                : <>These hosts carry the most open findings — the fastest place to cut exposure.</>}</Insight>
              <AssetTreemap data={m.treeData} max={m.assetMax} onSelect={setAssetModal} />
              <p style={{ fontSize: 10, color: FAINT, marginTop: 9 }}>Each tile is a host, sized by open findings; darker = heavier load. Click a host to see its findings.</p>
            </>
          )}
        </section>

        <section style={{ ...card, padding: '15px 17px', flex: '1 1 360px', minWidth: 0 }}>
          <CardHead title="Severity × asset criticality" sub="where the blast actually lands" Icon={Crosshair} />
          {m.matrix.length === 0 ? <Empty>No findings linked to a criticality-rated asset yet.</Empty> : (
            <>
              <Insight>{m.dangerCorner > 0
                ? <><b style={{ color: '#C2453F' }}>{m.dangerCorner}</b> Critical/High findings sit on business-critical assets — the danger corner, and where the next remediation cycle should go first.</>
                : <>No Critical/High findings currently land on business-critical assets — the heaviest load sits on lower-value hosts.</>}</Insight>
              <div style={{ marginTop: 12, overflowX: 'auto', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '92px repeat(5, minmax(42px,1fr))', gridAutoRows: '36px', gap: 4, minWidth: 330 }}>
                  <span />
                  {SEV_ORDER.map((k) => <div key={k} style={{ ...cap, fontSize: 9, textAlign: 'center', paddingBottom: 2, color: SEV[k].c }}>{SEV[k].label}</div>)}
                  {m.matrix.map((r) => <HeatRow key={r.asset_criticality} r={r} max={m.matrixMax} />)}
                </div>
                <p style={{ fontSize: 10, color: FAINT, marginTop: 10 }}>Darker = more open findings of that severity on assets of that criticality. Top-left is the danger corner.</p>
              </div>
            </>
          )}
        </section>
      </div>

      {/* ══ ROW 4 — remediation posture · fix these first ══ */}
      <div style={row}>
        <section style={{ ...card, padding: '15px 17px', flex: '1 1 360px', minWidth: 0 }}>
          <CardHead title="Remediation posture" sub="where findings sit in the lifecycle" Icon={GitBranch} />
          {/* Prominent headline — resolved vs open at a glance (leads the card). */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: m.closedCount ? '#1F7A54' : INK, ...TNUM }}>{m.closedCount}</span>
              <span style={{ fontSize: 12.5, color: SEC }}>resolved</span>
            </span>
            <span style={{ fontSize: 22, color: FAINT, lineHeight: 1 }}>/</span>
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: m.totalOpen ? '#C0682F' : INK, ...TNUM }}>{m.totalOpen}</span>
              <span style={{ fontSize: 12.5, color: SEC }}>open</span>
            </span>
            <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <span style={{ display: 'block', fontSize: 20, fontWeight: 700, lineHeight: 1, color: '#1F7A54', ...TNUM }}>{closedPct}%</span>
              <span style={{ display: 'block', fontSize: 10.5, color: MUTED, marginTop: 3 }}>of {m.registerTotal} closed</span>
            </span>
          </div>
          <p style={{ fontSize: 12, color: SEC, lineHeight: 1.5, margin: '9px 0 0' }}>
            {m.registerTotal === 0 ? <>No findings recorded yet.</>
              : m.fixAvailable > 0 ? <>A vendor fix is <b style={{ color: '#1F7A54' }}>already published</b> for <b>{m.fixAvailable}</b> open finding{m.fixAvailable === 1 ? '' : 's'} — patch-ready wins sitting on the table.</>
              : <><b>{m.totalOpen}</b> finding{m.totalOpen === 1 ? '' : 's'} still open and awaiting remediation.</>}
          </p>
          {m.statusTotal > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', height: 28, borderRadius: 999, overflow: 'hidden', background: '#EEF1F3', gap: 2, boxShadow: 'inset 0 1px 2px rgba(16,24,40,.07)' }}>
                {m.statusDist.map((s) => <i key={s.k} title={`${s.label}: ${s.n} (${pct(s.n, m.statusTotal)}%)`} style={{ width: `${(s.n / m.statusTotal) * 100}%`, background: `linear-gradient(180deg, ${s.c}D8, ${s.c})`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3)', minWidth: s.n > 0 ? 3 : 0 }} />)}
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                {m.statusDist.map((s) => (
                  <span key={s.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: s.c, flex: 'none' }} />
                    <span style={{ color: SEC }}>{s.label}</span>
                    <b style={{ color: INK, ...TNUM }}>{s.n}</b>
                    <span style={{ color: FAINT, fontSize: 10.5, ...TNUM }}>{pct(s.n, m.statusTotal)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* The 4 posture tiles fill the lower half as an even 2×2 that stretches
             to the card's (tall, equal-to-neighbour) height — no dead bottom gap. */}
          <div style={{ flex: 1, minHeight: 0, marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gridAutoRows: 'minmax(64px, 1fr)', gap: 11 }}>
            <PostureStat Icon={ShieldCheck} label="Closed / verified / accepted" n={m.closedCount} tone="#1F7A54" />
            <PostureStat Icon={ShieldCheck} label="Vendor patch available" n={m.fixAvailable} tone={m.fixAvailable ? '#1F7A54' : MUTED} />
            <PostureStat Icon={ShieldCheck} label="Has a mitigation on file" n={m.mitigated} tone={m.mitigated ? AC : MUTED} />
            <PostureStat Icon={FileWarning} label="Carries a CVE" n={m.withCve} tone={INK} />
          </div>
        </section>

        <section style={{ ...card, flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 17px', borderBottom: `1px solid ${BORDER2}` }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: '#FBEAEA', color: '#C2453F', display: 'grid', placeItems: 'center', flex: 'none' }}><Flame size={15} /></span>
            <b style={{ fontSize: 14 }}>Fix these first</b>
            <span style={{ fontSize: 11, color: MUTED, marginLeft: 'auto' }}>top {m.fixFirst.length} of {m.totalOpen} open · ranked · click to open</span>
          </div>
          {m.fixFirst.length === 0 ? <Empty pad>Nothing open right now — the queue is clear.</Empty> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {m.fixFirst.map((v) => {
                  const score = ctx(v); const sc = normSev(v.severity); const assets = v.linked_assets || [];
                  const tone = score == null ? FAINT : score >= 70 ? '#C2453F' : score >= 40 ? '#9A6410' : '#1F7A54';
                  const dr = drivers(v);
                  return (
                    <tr key={v.id} onClick={() => onView(v)} style={{ cursor: 'pointer' }} className="ccrow">
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER2}`, width: 56 }}>
                        <span style={{ display: 'inline-block', minWidth: 40, textAlign: 'center', background: `${tone}16`, color: tone, borderRadius: 8, padding: '4px 6px', fontFamily: MONO, fontWeight: 700, fontSize: 12.5, ...TNUM }}>{score ?? '—'}</span>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER2}`, maxWidth: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: SEV[sc].c, flex: 'none' }} />
                          <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.title}>{shortenVulnTitle(v.title)}</span>
                          {dr.slice(0, 2).map((d) => <span key={d.t} style={{ fontSize: 9, fontWeight: 700, color: d.c, background: `${d.c}16`, borderRadius: 999, padding: '1px 7px', flex: 'none', whiteSpace: 'nowrap' }}>{d.t}</span>)}
                          {dr.length > 2 && <span style={{ fontSize: 9.5, color: FAINT, flex: 'none' }}>+{dr.length - 2}</span>}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER2}`, fontFamily: MONO, fontSize: 10.5, color: FAINT, whiteSpace: 'nowrap' }}>{v.cve_id || `VULN-${v.id}`}</td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER2}`, fontSize: 12, color: assets.length ? SEC : FAINT, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={assets.join(', ')}>{assets.length ? `${assets[0]}${assets.length > 1 ? ` +${assets.length - 1}` : ''}` : '—'}</td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER2}`, textAlign: 'right', width: 20 }}><ArrowRight size={13} color={FAINT} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* ══ ROW 5 — open backlog age · threat-intel & signal coverage ══ */}
      <div style={row}>
        <section style={{ ...card, padding: '15px 17px', flex: '1 1 300px', minWidth: 0 }}>
          <CardHead title="Open backlog age" sub="time since discovery" Icon={Clock3} />
          <Insight>{m.stubborn > 0
            ? <><b style={{ color: '#C2453F' }}>{m.stubborn}</b> finding{m.stubborn === 1 ? '' : 's'} {m.stubborn === 1 ? 'has' : 'have'} aged past 90 days — stale risk that signals a remediation bottleneck, not fresh discovery.</>
            : m.fresh > 0 ? <>Nothing has aged past 90 days — the backlog is fresh and moving.</> : <>No datable findings in the open backlog yet.</>}</Insight>
          <AgeBars rows={m.ageRows} height={132} />
        </section>

        <section style={{ ...card, padding: '15px 17px', flex: '1 1 300px', minWidth: 0, background: ACSOFT, borderColor: '#D7E6F2' }}>
          <CardHead title="Threat intel & signal coverage" sub="live exploit / probability enrichment" Icon={ShieldAlert} />
          <Insight>
            {m.enrichBase === 0
              ? <>No open findings to enrich.</>
              : m.enriched === 0
                ? <>Live exploit &amp; probability feeds haven&apos;t run for these <b>{m.enrichBase}</b> findings. Blank means <b>unscored</b>, not <b>zero risk</b> — the panels above rank on CVSS, exposure and asset context.</>
                : <>Enriched <b>{m.enriched} of {m.enrichBase}</b> open findings. The rest are unscored, not risk-free.</>}
          </Insight>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '13px 10px', flex: 1, alignContent: 'space-between' }}>
            {covStats.map((s) => (
              <div key={s.label} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div>
                <b style={{ fontSize: 18, fontWeight: 700, color: s.tone, ...TNUM }}>{s.value}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      {assetModal != null && (
        <AssetVulnModal
          name={assetModal}
          findings={m.assetVulnMap.get(assetModal.trim().toLowerCase()) ?? []}
          onClose={() => setAssetModal(null)}
          onView={(v) => { setAssetModal(null); onView(v); }}
        />
      )}

      <style>{`.ccrow:hover{background:#F6FAFD}.ccrow:hover td:first-child{box-shadow:inset 3px 0 0 ${AC}}`}</style>
    </div>
  );
}

// ── premium recharts marks ──────────────────────────────────────────────────
function SeverityDonut({ data, total }: { data: { k: string; label: string; c: string; n: number }[]; total: number }) {
  const slices = data.filter((d) => d.n > 0);
  const empty = slices.length === 0;
  const pieData = empty ? [{ k: 'none', label: 'None', c: '#EAEEF1', n: 1 }] : slices;
  return (
    <div style={{ position: 'relative', width: 176, height: 176, flex: 'none', filter: 'drop-shadow(0 6px 12px rgba(16,24,40,.12))' }}>
      <PieChart width={176} height={176}>
        <Pie data={pieData} dataKey="n" nameKey="label" cx="50%" cy="50%" innerRadius={60} outerRadius={82}
          paddingAngle={empty || slices.length < 2 ? 0 : 2} cornerRadius={4} stroke="#fff" strokeWidth={1.5}
          startAngle={90} endAngle={-270} isAnimationActive animationDuration={750}>
          {pieData.map((d, i) => <Cell key={i} fill={empty ? '#EAEEF1' : `url(#sgv-${d.k})`} />)}
        </Pie>
        {!empty && <Tooltip content={<ChartTip />} />}
      </PieChart>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1, color: INK, ...TNUM }}>{total}</div>
          <div style={{ fontSize: 9.5, letterSpacing: '.13em', color: FAINT, marginTop: 4, fontWeight: 600 }}>OPEN FINDINGS</div>
        </div>
      </div>
    </div>
  );
}

function HBars({ rows, labelWidth, height }: { rows: { label: string; n: number; grad: string; c: string }[]; labelWidth: number; height: number }) {
  return (
    <div style={{ width: '100%', flex: 1, minHeight: height, marginTop: 10 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={rows} margin={{ top: 2, right: 30, bottom: 2, left: 0 }} barCategoryGap={9}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="label" width={labelWidth} tickLine={false} axisLine={false} tick={<HTick />} />
          <Tooltip cursor={{ fill: 'rgba(0,91,150,.05)' }} content={<ChartTip />} />
          <Bar dataKey="n" radius={[0, 6, 6, 0]} background={{ fill: '#F1F4F6', radius: 6 } as any} isAnimationActive animationDuration={650}>
            {rows.map((r, i) => <Cell key={i} fill={r.grad} />)}
            <LabelList dataKey="n" position="right" style={{ fill: INK, fontSize: 12, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AgeBars({ rows, height }: { rows: { label: string; n: number; grad: string; c: string }[]; height: number }) {
  return (
    <div style={{ width: '100%', flex: 1, minHeight: height, marginTop: 14 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 20, right: 8, bottom: 2, left: 8 }} barCategoryGap="24%">
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: BORDER }} tick={{ fontSize: 11, fill: MUTED }} />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip cursor={{ fill: 'rgba(0,91,150,.05)' }} content={<ChartTip />} />
          <Bar dataKey="n" radius={[6, 6, 0, 0]} background={{ fill: '#F4F6F8', radius: [6, 6, 0, 0] } as any} isAnimationActive animationDuration={650}>
            {rows.map((r, i) => <Cell key={i} fill={r.grad} />)}
            <LabelList dataKey="n" position="top" style={{ fill: INK, fontSize: 13, fontWeight: 700 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Relative luminance (WCAG) → pick dark-vs-white text that actually contrasts with the fill.
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); })
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
};
// Deeper ramp: the light end isn't washed out and the mid stops skip the murky zone where
// neither dark nor white text reads — so every tile is legible (dark text ≤ idx2, white ≥ idx3).
// No murky-middle stop: every tile is clearly LIGHT (dark text, lum ≥ .27) or clearly DEEP
// (white text, lum ≤ .11). The old #2E77AB sat at lum .167 — under the .22 white threshold yet
// visually a grey-blue, so white text read as "white on light grey". Replaced with #4F93CB (lum
// .27 → dark text) so no stop lands in the zone where white-on-light can happen.
const TREE_RAMP = ['#DCEAF4', '#B9D6EA', '#7FB0D6', '#4F93CB', '#0A5E97', '#064A78'];
function AssetTreemap({ data, max, onSelect }: { data: { name: string; size: number; kev: number; crit: string | null }[]; max: number; onSelect?: (name: string) => void }) {
  // Plain HTML/CSS tiles — NOT a recharts SVG. The workspace's zoom:0.8 density wrapper makes an SVG
  // rasterize-then-downscale → blurry text + a bare-"12" fallback on tiny tiles (nested CSS zoom can't
  // be reliably cancelled in Chrome). HTML lays out + rasterizes at the effective zoom, so text is
  // crisp, and a flex min-width guarantees the host NAME always shows (CSS ellipsis, never dropped).
  // Width ∝ open findings (heaviest host widest); colour = load (TREE_RAMP); wraps when many hosts.
  const rampIdx = (n: number) => Math.max(0, Math.min(TREE_RAMP.length - 1, Math.round(Math.min(1, n / Math.max(1, max)) * (TREE_RAMP.length - 1))));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1, minHeight: 264, marginTop: 12, alignContent: 'stretch' }}>
      {data.map((d, i) => {
        const bg = TREE_RAMP[rampIdx(d.size)];
        const fg = lum(bg) < 0.22 ? '#fff' : '#012A4A';
        const clickable = !!onSelect && !!d.name;
        return (
          <button key={`${d.name}-${i}`} type="button"
            title={`${d.name} · ${d.size} open${d.kev > 0 ? ` · ${d.kev} KEV (known exploited in the wild)` : ''}${clickable ? ' · click for findings' : ''}`}
            onClick={clickable ? () => onSelect!(d.name) : undefined}
            style={{ flex: `${Math.max(d.size, 1)} 1 120px`, minWidth: 120, minHeight: 84, background: bg, color: fg,
                     border: '2px solid #fff', borderRadius: 8, padding: '10px 12px', textAlign: 'left',
                     display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2,
                     cursor: clickable ? 'pointer' : 'default', overflow: 'hidden' }}>
            <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, ...TNUM }}>{d.size}</span>
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{d.name}</span>
            {d.kev > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: fg === '#fff' ? '#FFD9D6' : '#9A2A24' }}>{d.kev} CVE</span>}
          </button>
        );
      })}
      {!data.length && <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 264, color: FAINT, fontSize: 12 }}>No assets with open findings.</div>}
    </div>
  );
}

function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const name = p?.payload?.label ?? p?.payload?.name ?? p?.name ?? '';
  const val = p?.value ?? p?.payload?.n ?? p?.payload?.size ?? '';
  const color = p?.payload?.c || p?.color || AC;
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '7px 11px', boxShadow: '0 6px 18px rgba(16,24,40,.14)', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flex: 'none' }} />
        <span style={{ color: SEC, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <b style={{ marginLeft: 12, color: INK, ...TNUM }}>{val}</b>
      </div>
    </div>
  );
}
function HTick({ x, y, payload }: any) {
  const label = String(payload?.value ?? '');
  const text = label.length > 17 ? label.slice(0, 16) + '…' : label;
  return <text x={x} y={y} dy={4} textAnchor="end" fontSize={11.5} fill={SEC}><title>{label}</title>{text}</text>;
}

// ── small primitives ──
function CardHead({ title, sub, Icon, tone = ACS }: { title: string; sub?: string; Icon?: typeof Flame; tone?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: `${tone}14`, color: tone, display: 'grid', placeItems: 'center', flex: 'none' }}>
        {Icon ? <Icon size={15} /> : <span style={{ width: 4, height: 13, borderRadius: 2, background: tone }} />}
      </span>
      <b style={{ fontSize: 14 }}>{title}</b>
      {sub && <span style={{ fontSize: 11, color: MUTED }}>{sub}</span>}
    </div>
  );
}
function Insight({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12.5, color: SEC, lineHeight: 1.55, margin: '9px 0 0' }}>{children}</p>;
}
function Empty({ children, pad }: { children: React.ReactNode; pad?: boolean }) {
  return <div style={{ fontSize: 11.5, color: FAINT, marginTop: pad ? 0 : 12, padding: pad ? '22px 16px' : 0, lineHeight: 1.5 }}>{children}</div>;
}
function PostureStat({ Icon, label, n, tone }: { Icon: typeof Flame; label: string; n: number; tone: string }) {
  return (
    <div style={{ flex: '1 1 160px', minWidth: 0, border: `1px solid ${BORDER2}`, borderRadius: 12, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 11, background: 'linear-gradient(180deg,#fff,#FCFDFE)' }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: `${tone}14`, color: tone, display: 'grid', placeItems: 'center', flex: 'none' }}><Icon size={16} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: tone, ...TNUM }}>{n}</div>
        <div style={{ fontSize: 10.5, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      </div>
    </div>
  );
}
function MiniStat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10.5, color: MUTED, whiteSpace: 'nowrap' }}>{label}</div>
      <b style={{ fontSize: 17, fontWeight: 700, color: tone, ...TNUM }}>{value}</b>
    </div>
  );
}
function HeatRow({ r, max }: { r: { asset_criticality: string; critical: number; high: number; medium: number; low: number; info: number }; max: number }) {
  const cells = [r.critical, r.high, r.medium, r.low, r.info];
  // Pure ComplyVerse blue, light → deep brand #005B96. Same no-murky-middle rule as the treemap:
  // the old #2E77AB (lum .167) got white text yet looked grey-blue → "white on light grey".
  // Replaced with #1766A0 (lum .12 → clearly deep, white text reads cleanly).
  const ramp = ['#EAF2F9', '#CBE0F0', '#9FC4E4', '#5E9BCE', '#1766A0', '#005B96'];
  const shade = (t: number) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))))];
  return (
    <>
      <div style={{ fontSize: 11, color: SEC, display: 'flex', alignItems: 'center', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.asset_criticality}>{r.asset_criticality || 'Unknown'}</div>
      {cells.map((n, i) => {
        const t = n / max; const bg = n === 0 ? '#F4F7FA' : shade(t); const white = n > 0 && lum(bg) < 0.22; const fg = n === 0 ? '#6B7787' : white ? '#fff' : INK;
        return <div key={i} style={{ background: bg, color: fg, borderRadius: 6, height: '100%', minHeight: 34, display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: n > 0 ? 700 : 500, boxShadow: n > 0 ? 'inset 0 1px 0 rgba(255,255,255,.18)' : 'none', ...TNUM }}>{n}</div>;
      })}
    </>
  );
}

// ── Asset → its open findings: blur-background drill-down popup ──────────────
// Mirrors the Inventory drill-down modal: a <body> portal (escapes the workspace's
// zoom:0.8 + any page colour scope), a dim + backdrop-blur scrim, Esc / click-scrim
// / X to close, and an internally scrolling body. Shows one host's OPEN findings —
// a severity breakdown then a scrollable list; a row opens that finding through the
// page's onView (client-side nav to /vulnerabilities/[id], which dodges the dev
// hard-load SSR-worker 500).
function AssetVulnModal({ name, findings, onClose, onView }: {
  name: string; findings: Vulnerability[]; onClose: () => void; onView: (v: Vulnerability) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === 'undefined') return null;

  const sevCounts = SEV_ORDER.map((k) => ({ k, label: SEV[k].label, c: SEV[k].c, n: findings.filter((v) => normSev(v.severity) === k).length }));
  const sorted = [...findings].sort((a, b) => (SEV_RANK[normSev(b.severity)] - SEV_RANK[normSev(a.severity)]) || ((ctx(b) ?? -1) - (ctx(a) ?? -1)));

  return createPortal(
    <div role="presentation" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
               background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}>
      <div role="dialog" aria-modal="true" aria-label={`Open findings on ${name}`} onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(600px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                 background: '#fff', borderRadius: 16, border: `1px solid ${BORDER}`, borderTop: `3px solid ${AC}`, boxShadow: '0 24px 64px rgba(15,23,42,0.3)', color: INK, fontSize: 13.5 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px 12px', borderBottom: `1px solid ${BORDER2}` }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: `${AC}14`, color: ACS, display: 'grid', placeItems: 'center', flex: 'none' }}><Server size={16} /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{findings.length} open finding{findings.length === 1 ? '' : 's'} on this host</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, flex: 'none', borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', color: SEC, cursor: 'pointer' }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16 }}>
          {findings.length === 0 ? (
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, padding: '6px 2px' }}>No open findings in the register are linked to this host by name.</div>
          ) : (
            <>
              {/* severity breakdown */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {sevCounts.map((s) => (
                  <div key={s.k} style={{ flex: '1 1 84px', minWidth: 0, border: `1px solid ${BORDER2}`, borderRadius: 10, padding: '7px 10px', background: s.n ? `${s.c}0D` : '#FBFCFD' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: s.n ? SEC : FAINT }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: s.c, flex: 'none', opacity: s.n ? 1 : 0.45 }} />{s.label}
                    </div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: s.n ? INK : FAINT, ...TNUM }}>{s.n}</div>
                  </div>
                ))}
              </div>
              {/* findings — worst severity / highest contextual priority first */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sorted.map((v) => {
                  const sc = normSev(v.severity);
                  return (
                    <button key={v.id} type="button" onClick={() => onView(v)} className="avmrow"
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit',
                               border: `1px solid ${BORDER2}`, borderRadius: 10, padding: '9px 11px', background: '#fff', color: INK }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: 84, flex: 'none' }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: SEV[sc].c, flex: 'none' }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: SEV[sc].c, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{SEV[sc].label}</span>
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.title}>{shortenVulnTitle(v.title)}</span>
                      {v.cve_id && <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, flex: 'none' }}>{v.cve_id}</span>}
                      <ArrowRight size={13} color={FAINT} style={{ flex: 'none' }} />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <style>{`.avmrow:hover{background:#F6FAFD;border-color:${AC}55}`}</style>
      </div>
    </div>,
    document.body,
  );
}
