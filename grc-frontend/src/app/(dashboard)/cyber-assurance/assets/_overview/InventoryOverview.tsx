'use client';

/**
 * IT Asset Inventory — Overview: the inventory-native estate dashboard.
 *
 * Its own identity, distinct from the Performance dashboard (risk gauge + module
 * lenses) and the Vulnerabilities dashboard (findings donut + threat charts):
 * THIS surface answers "what is the estate MADE OF, and how complete & well-governed
 * is our knowledge of it" — composition, telemetry coverage and hygiene across every
 * dimension the Inventory module holds, including the depth that lives in the asset
 * detail tabs, rolled up estate-wide.
 *
 * Structure = the SME-approved droplet layout, enriched. A full-width estate-summary strip,
 * then the External/Internal → class hierarchy as TWO distinct cards (each owning its own
 * aggregations), the per-class assurance matrix and the largest-gaps list — with the richer
 * estate lenses laid out around them. 12-col so the matrix can run wider than the gaps list.
 *   • Estate header — size, external/internal, freshness, ownership, service.
 *   • External attack surface | Internal estate — by-type / by-infra + a second breakdown
 *       (outside-in verification · OS family) + coverage stats; EVERY class/OS row is a
 *       drill-down disclosure (within-kind versions/engines, hygiene, criticality, named
 *       assets); external also carries a registrable-domain concentration readout.
 *   • Asset-class matrix | Needs attention — coverage & assurance per class; largest gaps first.
 *   • Software & versions | Criticality & data · Lifecycle | Ownership · Provenance |
 *       Telemetry coverage | Obsolescence · Regulatory scope | Estate scale.
 *
 * Every number is live from /estate-overview (read-only aggregate, counts only),
 * /assets/inventory-overview (performance + attention queue) and
 * /discovery/discovered-devices (onboarding). Nothing is sampled or invented: a failing
 * source says so, an empty dimension says "none"/"not collected yet", unknowns stay grey.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ArrowRight, Boxes, CalendarClock, ChevronRight, ClipboardCheck, Cpu, Globe,
  Layers, Monitor, Package, Radar, RefreshCw, Server, ShieldCheck, Users, X,
} from 'lucide-react';
import apiClient, { discoveryApi } from '@/cyber-assurance/lib/api';
import { SCORECARD_QUERY_KEYS } from '@/cyber-assurance/components/dashboard/scorecard-query-keys';
import {
  CARD_SHADOW, Empty, FONT, Key, Loading, Pill, SEV, Skel, T, Unavailable,
  alpha, nfmt, pctOf, plural, share, type Tone,
} from '../../dashboard/_components/kit';
import { BarList, PartLegend, StackBar, type BarRow, type Part } from '../../dashboard/_components/charts';

/* ---------- API shapes (only the fields this page reads; all additive keys optional) ---------- */
type Named = { label: string; n: number; gap?: boolean };
type Sample = { id?: number | null; name: string; sub: string; crit?: string };
type Sub = { label: string; n: number; gap: boolean; eol_past?: number; subtypes?: Sub[]; samples?: Sample[] };
type SwRow = { key: string; label: string; version: string; n: number };
type Crit = Record<'critical' | 'high' | 'medium' | 'low' | 'unrated', number>;
type Eol = { past: number; soon: number; known: number };
type Roots = { distinct: number; named: number; top: Named[]; more: number };
type Cls = { label: string; n: number; gap: boolean; subtypes: Sub[]; samples?: Sample[]; seen_30d: number; owner: number; cis: number | null; crit: Crit; eol: Eol | null };
type Side = { total: number; classes: Cls[]; facets: Record<string, number>; verification?: Sub[]; hosting?: Sub[]; roots?: Roots; os?: Sub[] };
type Estate = {
  total: number; rolled_total?: number; rolled_external?: number; external: Side; internal: Side; unidentified: number;
  coverage: { seen_30d: number; owner: number; cis: number }; eol: Eol; lifecycle: Named[];
  governance?: { criticality: Crit; environment: Named[]; data_classification: Named[] };
  provenance?: { origin: Named[]; managed: number; discovered: number; baseline: number };
  ownership?: { owned: number; unowned: number; with_team: number; teams: Named[] };
  security?: { scope: number; posture: number; antivirus: number; edr: number; edr_stopped: number; protected: number; packages: number; inventoried: number; families: Named[] };
  compliance?: { cde: number; ephi: number; in_scope: number; regulated: Named[]; regulated_none: number; scopes: Named[] };
  freshness?: { buckets: Named[]; stale: number };
  completeness?: { total: number; dims: { key: string; label: string; n: number; of: number; scope: string }[] };
  capacity?: { hosts: number; vcpu: number; ram_gb: number; disk_gb: number; valuation_sum: number; valuation_n: number; purchase_sum: number; purchase_n: number };
  software?: { hosts_reporting: number; products: number; installs: number; top: SwRow[]; more: number; external: { sites: number; products: number; top: SwRow[]; more: number } };
};
type FleetBand = 'excellent' | 'good' | 'fair' | 'poor';
type FleetCis = {
  avg: number | null; grade: string | null; scanned: number; unscanned: number;
  bands: Record<FleetBand, number>;
  worst: { id: number; name: string; score: number; band: FleetBand; criticality?: string | null }[];
};
type InvOverview = {
  no_data?: boolean;
  performance?: { score: number | null; grade: string | null };
  attention_queue?: { assets_unassessed: number; open_critical_high_vulns: number };
  fleet_cis?: FleetCis;
};
type Devices = { devices?: { in_inventory?: boolean }[] };
type Q<X> = { data?: X | null; isLoading: boolean; isError: boolean; isFetching?: boolean };
const busy = (q: Q<unknown>) => !!q.isFetching && !q.isLoading;

const KEYS = {
  estate: ['assets', 'estate-overview'], // under ['assets'] so register edits refresh it too
  inv: [...SCORECARD_QUERY_KEYS.assets], // shared with the register scorecard + Performance
  devices: ['disc-discovered-devices', 'all'],
};
const REG = '/assets?tab=inventory';
/** /assets reads ?tab= only when it mounts, so a client-side push to another tab of THIS
    page would change the URL but leave the Overview showing — same-page links navigate for
    real; every other route keeps Next's client-side Link. */
function Go({ href, ...rest }: { href: string; className?: string; title?: string; children: ReactNode }) {
  return href.startsWith('/assets?') ? <a href={href} {...rest} /> : <Link href={href} {...rest} />;
}

/* Colour language — the product's own tokens only. External = base blue, Internal = success
   green (the validated categorical pair the register already uses); gaps / unknowns = grey.
   External / Internal carry a label + icon everywhere, never colour alone. */
const GREY = '#CBD5E1';
const EXT_C = T.base, INT_C = T.success;
const SIDE = {
  external: { c: T.base, name: 'External attack surface', blurb: 'Internet-facing names & services, verified outside-in', icon: Globe, view: 'external' },
  internal: { c: T.success, name: 'Internal estate', blurb: 'Hosts & devices on your networks, read with credentials', icon: Server, view: 'internal' },
} as const;
const CRIT: { k: keyof Crit; label: string; c: string }[] = [
  { k: 'critical', label: 'Critical', c: SEV.critical.c }, { k: 'high', label: 'High', c: SEV.high.c },
  { k: 'medium', label: 'Medium', c: SEV.medium.c }, { k: 'low', label: 'Low', c: SEV.low.c },
  { k: 'unrated', label: 'Unrated', c: GREY },
];
// Rows always shown (the taxonomy a reader expects); the rest appear only when present.
const INT_CORE = ['Server', 'Workstation / endpoint', 'Database', 'Network device', 'Unidentified'];
const OS_CORE = ['Windows Server', 'Windows client', 'Linux', 'macOS', 'Network OS'];
const absentNote = (labels: string[]) => (labels.length ? `Also tracked, none found: ${labels.join(' · ')}` : undefined);

/* Page-scope fixes, injected once by the overview:
   1. flip the (cream) asset-suite canvas to the dashboard grey so the white cards lift off it;
   2. the asset page wraps every tab in `.assets-light`, whose global rules paint h2/p/li/span/
      td pure black (td !important) and outrank Tailwind's colour utilities — it flattened every
      muted label here. Inside the overview: inherit by default, re-assert the colours we use. */
const INK = ['#0F172A', '#334155', '#475569', '#64748B', '#94A3B8', '#CBD5E1', '#005B96'];
const SCOPE_CSS = [
  '.asset-suite:has([data-inv-overview]),main:has([data-inv-overview]){background:#EDF0F5}',
  '[data-inv-overview] :is(h1,h2,h3,h4,h5,p,li,label,span,dt,dd){color:inherit}',
  '[data-inv-overview] :is(table,tr,td){color:inherit!important}',
  '[data-inv-overview] td{font-size:inherit}',
  ...INK.map((c) => `[data-inv-overview] [class~="text-[${c}]"]{color:${c}!important}`),
  '[data-inv-overview] [class~="hover:text-[#014A81]"]:hover{color:#014A81!important}',
  '[data-inv-overview] a:hover>span[class~="text-[#334155]"]{color:#005B96!important}',
].join('');
/* The drill-down modal renders in a portal on <body> (outside .assets-light + the zoom:0.8
   container), so it needs its own scoped colour re-assertion — the same INK utilities, the
   anti-flatten rule, and a de-dimmed muted/subtle set — keyed off [data-inv-modal]. */
const MODAL_CSS = [
  '[data-inv-modal] :is(h1,h2,h3,h4,h5,p,li,label,span,dt,dd,b,a){color:inherit}',
  ...INK.map((c) => `[data-inv-modal] [class~="text-[${c}]"]{color:${c}!important}`),
  '[data-inv-modal] a[class~="hover:text-[#005B96]"]:hover,[data-inv-modal] a:hover [class~="hover:text-[#005B96]"]{color:#005B96!important}',
  '@keyframes invScrimIn{from{opacity:0}to{opacity:1}}',
  '@keyframes invDrawerIn{from{transform:translateX(24px);opacity:.3}to{transform:translateX(0);opacity:1}}',
].join('');

export default function InventoryOverview() {
  const qc = useQueryClient();
  const estateQ = useQuery<Estate>({ queryKey: KEYS.estate, queryFn: async () => (await apiClient.get('/estate-overview')).data });
  const invQ = useQuery<InvOverview | null>({
    queryKey: KEYS.inv,
    queryFn: async () => { try { return (await apiClient.get('/assets/inventory-overview')).data; } catch { return null; } },
  });
  const devicesQ = useQuery<Devices>({ queryKey: KEYS.devices, queryFn: async () => (await discoveryApi.discoveredDevices()).data, retry: 1 });

  const all = [estateQ, invQ, devicesQ];
  const fetching = all.some((q) => q.isFetching);
  const failed = all.filter((q) => q.isError).length + (invQ.isSuccess && invQ.data === null ? 1 : 0);
  const latest = Math.max(0, ...all.map((q) => q.dataUpdatedAt || 0));
  const [updated, setUpdated] = useState(0);
  useEffect(() => { if (!fetching && latest) setUpdated(latest); }, [fetching, latest]);
  const refresh = () => Object.values(KEYS).forEach((queryKey) => qc.invalidateQueries({ queryKey, refetchType: 'all' }));
  const d = estateQ.data;

  return (
    // The SME-approved droplet layout: a full-width summary strip, then the External/Internal →
    // class hierarchy as two DISTINCT cards (each owning its own aggregations), the per-class
    // assurance matrix and the largest-gaps list — with the richer estate lenses laid out around
    // them. 12-col so the matrix (8) can run wider than the attention list (4); everything else pairs 6/6.
    <div data-inv-overview className="mx-auto grid w-full max-w-[1950px] grid-cols-1 gap-3 text-[#0F172A] xl:grid-cols-12" style={{ fontFamily: FONT, zoom: 0.8 }}>
      <style>{SCOPE_CSS}</style>

      <EstateHeader estate={estateQ} inv={invQ} devices={devicesQ} className="xl:col-span-12"
        stamp={
          <div className="flex shrink-0 items-center gap-3 px-5 text-[12px] text-[#64748B]">
            <span aria-live="polite" className="whitespace-nowrap">
              {updated ? `Live · ${new Date(updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading…'}
              {!fetching && failed > 0 && <span className="ml-2 inline-flex items-center gap-1"><AlertTriangle size={12} aria-hidden style={{ color: T.warning }} />{plural(failed, 'source')} didn&rsquo;t respond</span>}
            </span>
            <button type="button" onClick={refresh} disabled={fetching} aria-label="Refresh"
              className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#E2E5EC] bg-white text-[#334155] hover:bg-[#F6F7FB] disabled:cursor-default disabled:opacity-70">
              <RefreshCw size={14} aria-hidden className={fetching ? 'animate-spin' : ''} style={{ color: T.base }} />
            </button>
          </div>
        } />

      {/* ── Fleet compliance score — the per-asset CIS score rolled up estate-wide (headline) ── */}
      <FleetScoreCard inv={invQ} className="xl:col-span-12" />

      {/* ── SME-approved core: External | Internal (two distinct cards), then the matrix & the gaps list ── */}
      <SidePanel kind="external" q={estateQ} className="xl:col-span-6"
        lists={d ? [
          { title: 'By type', mode: 'class', rows: d.external.classes },
          { title: 'Outside-in verification', mode: 'plain', rows: d.external.verification ?? [] },
        ] : []}
        roots={d?.external.roots}
        stats={d ? [
          { label: 'Probed outside-in', value: share(d.external.facets.probed, d.external.total) || '0%', sub: `${nfmt(d.external.facets.probed)} of ${nfmt(d.external.total)} names` },
          { label: 'Behind CDN / WAF', value: nfmt(d.external.facets.cdn_waf), sub: `of ${nfmt(d.external.facets.probed)} probed` },
          { label: 'TLS certificate expired', value: nfmt(d.external.facets.tls_expired), alarm: d.external.facets.tls_expired > 0 },
          { label: 'TLS expiring ≤30 days', value: nfmt(d.external.facets.tls_expiring_30d), alarm: d.external.facets.tls_expiring_30d > 0 },
        ] : []} />
      <SidePanel kind="internal" q={estateQ} className="xl:col-span-6"
        lists={d ? [
          { title: 'By infrastructure type', mode: 'class', rows: d.internal.classes.filter((c) => c.n > 0 || INT_CORE.includes(c.label)) },
          { title: 'By operating system', mode: 'os', rows: (d.internal.os ?? []).filter((o) => o.n > 0 || OS_CORE.includes(o.label)) },
        ] : []}
        note={d ? absentNote(d.internal.classes.filter((c) => !c.n && !INT_CORE.includes(c.label)).map((c) => c.label)) : undefined}
        stats={d ? [
          { label: 'OS profiled', value: share(d.internal.facets.os_profiled, d.internal.total) || '0%', sub: `${nfmt(d.internal.facets.os_profiled)} of ${nfmt(d.internal.total)}` },
          { label: 'CIS benchmarked', value: share(d.coverage.cis, d.internal.total) || '0%', sub: `${nfmt(d.coverage.cis)} of ${nfmt(d.internal.total)}` },
          { label: 'End-of-life dated', value: share(d.eol.known, d.internal.total) || '0%', sub: `${nfmt(d.eol.known)} of ${nfmt(d.internal.total)}` },
          { label: 'Past vendor end-of-life', value: nfmt(d.eol.past), sub: `${nfmt(d.eol.soon)} due ≤90 days`, alarm: d.eol.past > 0 },
        ] : []} />
      <AdvisoryExposureCard className="xl:col-span-12" />
      <ClassMatrix q={estateQ} className="xl:col-span-8" />
      <AttentionCard estate={estateQ} inv={invQ} className="xl:col-span-4" />

      {/* ── Richer estate lenses around the core ── */}
      {/* Equal-height rows (grid stretches each card to its taller sibling). Every card then fills
          that height with no dead gap: data-rich cards spread/fill their sections, sparse ones
          (Ownership, and any empty/loading state) centre so the stretch reads as intentional. */}
      <SoftwareCard q={estateQ} className="xl:col-span-6" />
      <CoverageCard q={estateQ} className="xl:col-span-6" />
      <ComplianceCard q={estateQ} className="xl:col-span-6" />
      <ClassificationCard q={estateQ} className="xl:col-span-6" />
      <OwnershipCard q={estateQ} className="xl:col-span-6" />
      <LifecycleCard q={estateQ} className="xl:col-span-6" />
      <ProvenanceCard q={estateQ} className="xl:col-span-6" />
      <ObsolescenceCard q={estateQ} className="xl:col-span-6" />
      <ScanCoverageCard estate={estateQ} inv={invQ} className="xl:col-span-12" />
      {/* ScaleCard spans full width: with SecurityCard removed, 9 half-cards would leave a
          half-empty final row — a full-width fleet-summary strip fills it cleanly instead. */}
      <ScaleCard q={estateQ} className="xl:col-span-12" />
    </div>
  );
}

/* ---------- shared card chrome (one header style for every surface) ---------- */
function Box({ title, sub, icon, aside, accent, busy: dim, className = '', children }: {
  title: ReactNode; sub?: ReactNode; icon?: ReactNode; aside?: ReactNode; accent?: string; busy?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <section aria-busy={dim || undefined}
      className={`flex min-w-0 flex-col rounded-[14px] border border-[#E2E5EC] bg-white p-[18px] ${CARD_SHADOW} ${className}`}
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}>
      <header className="mb-3 flex items-start gap-2.5">
        {icon && <span aria-hidden className="mt-[1px] grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]" style={{ background: alpha(accent ?? T.base, 0.1), color: accent ?? T.base }}>{icon}</span>}
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate font-semibold text-[#0F172A] !text-[13.5px] !leading-[1.3]">{title}</h2>
          {sub && <p className="m-0 mt-0.5 truncate text-[11.5px] text-[#64748B]">{sub}</p>}
        </div>
        {aside}
      </header>
      <div className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${dim ? 'opacity-50' : ''}`}>{children}</div>
    </section>
  );
}
const MoreLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Go href={href} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md text-[12px] font-semibold text-[#005B96] hover:text-[#014A81]">
    {children}<ArrowRight size={13} aria-hidden />
  </Go>
);
const Eyebrow = ({ children }: { children: ReactNode }) => (
  <p className="m-0 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.07em] text-[#64748B]">{children}</p>
);
/** A crisper small-caps section header (darker, no built-in margin) — used by the compliance-score
    card and the drill-down drawer so their section titles read clearly, not washed out. */
const ModalEyebrow = ({ children }: { children: ReactNode }) => (
  <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[.07em] text-[#64748B]">{children}</h3>
);
/** Small labelled figure (local — tolerant of ReactNode values + alarm tone). */
function Fig({ label, value, sub, alarm }: { label: ReactNode; value: ReactNode; sub?: ReactNode; alarm?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="m-0 truncate text-[11px] font-medium text-[#475569]">{label}</p>
      <p className="m-0 mt-0.5 flex items-baseline gap-1.5 text-[19px] font-semibold leading-[1.15]" style={{ color: alarm ? SEV.critical.ink : '#0F172A' }}>{value}</p>
      {sub && <p className="m-0 mt-0.5 truncate text-[11px] leading-[1.4] text-[#64748B]">{sub}</p>}
    </div>
  );
}
const bars = (rows: Named[] | undefined, color = T.base): BarRow[] =>
  (rows ?? []).map((r) => ({ key: r.label, label: r.label, n: r.n, c: r.gap ? GREY : color, title: r.label }));
/** Standard body gate: loading skeleton, failed-source notice, or the real content. */
function body<X>(q: Q<X>, what: string, render: (d: X) => ReactNode, rows = 6): ReactNode {
  if (q.isLoading) return <Loading rows={rows} />;
  if (!q.data) return <Unavailable what={what} />;
  return render(q.data);
}

/* ---------- 0) "What we scan" — the static scan-category menu + honest run state ----------
   Tenant-agnostic on purpose: every tenant (incl. a brand-new one) sees the same capabilities.
   Run state is derived ONLY from what this page already loads; a category with no signal here
   reads "Not run yet" — never a guessed "Run". `signal` names the one source that can prove a run. */
type ScanCat = { label: string; href?: string; signal?: 'cis' | 'vuln' };
const SCAN_MENU: { domain: string; cats: ScanCat[] }[] = [
  { domain: 'Compliance', cats: [{ label: 'CIS Benchmark', href: '/cyber-assurance/assets?tab=cis', signal: 'cis' }] },
  { domain: 'Vulnerability', cats: [{ label: 'Network / host vulnerability scan (Nessus / Nexpose)', href: '/cyber-assurance/vulnerabilities', signal: 'vuln' }] },
  { domain: 'Application & repo security', cats: ['CI/CD', 'SAST (source code)', 'SCA (dependencies)', 'Secrets', 'IaC / config', 'Mobile'].map((label) => ({ label, href: '/cyber-assurance/pentest' })) },
  { domain: 'Infrastructure', cats: ['Cloud', 'Kubernetes', 'Database', 'Storage', 'Virtualization', 'Network', 'Host'].map((label) => ({ label, href: '/cyber-assurance/pentest' })) },
];
/** Self-check: missing data -> false, so a fresh tenant shows every category "Not run yet".
    Vulnerability only has the open critical/high count in scope, so 0 can't prove a run -> "Not run yet". */
function scanRan(signal: ScanCat['signal'], estate?: Estate | null, inv?: InvOverview | null): boolean {
  if (signal === 'cis') return (estate?.coverage?.cis ?? 0) > 0 || (inv?.fleet_cis?.scanned ?? 0) > 0;
  if (signal === 'vuln') return (inv?.attention_queue?.open_critical_high_vulns ?? 0) > 0;
  return false;
}
const RAN_TONE: Tone = { label: 'Run', c: T.success, ink: T.success, bg: '#E7F5EE' };
const NOT_RAN_TONE: Tone = { label: 'Not run yet', c: GREY, ink: '#475569', bg: '#F1F5F9' };
function ScanCoverageCard({ estate, inv, className }: { estate: Q<Estate>; inv: Q<InvOverview>; className: string }) {
  const loading = estate.isLoading || inv.isLoading;
  return (
    <Box title="What we scan" sub="Every scan ComplyVerse can run — and whether it has run on this estate" icon={<Radar size={14} />} accent={T.base} className={className}>
      {loading ? <Loading rows={4} /> : (
        <div className="grid grid-cols-1 gap-x-7 gap-y-5 md:grid-cols-2 xl:grid-cols-4">
          {SCAN_MENU.map((g) => (
            <div key={g.domain} className="min-w-0">
              <Eyebrow>{g.domain}</Eyebrow>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {g.cats.map((c) => {
                  const tone = scanRan(c.signal, estate.data, inv.data) ? RAN_TONE : NOT_RAN_TONE;
                  return (
                    <li key={c.label} className="flex min-w-0 items-center justify-between gap-2 text-[12.5px] text-[#334155]">
                      {c.href ? <Go href={c.href} className="min-w-0 truncate font-medium text-[#005B96] hover:text-[#014A81]">{c.label}</Go> : <span className="min-w-0 truncate">{c.label}</span>}
                      <Pill tone={tone} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Box>
  );
}

/* ---------- 1) Estate header ---------- */
const GRADE_TONE: Record<string, Tone> = {
  excellent: { ...SEV.info, label: 'Excellent', c: T.success, ink: T.success, bg: '#E7F5EE' },
  good: { ...SEV.info, label: 'Good', c: T.success, ink: T.success, bg: '#E7F5EE' },
  fair: { ...SEV.medium, label: 'Fair' }, poor: { ...SEV.critical, label: 'Poor' },
};
function EstateHeader({ estate, inv, devices, stamp, className }: { estate: Q<Estate>; inv: Q<InvOverview>; devices: Q<Devices>; stamp: ReactNode; className: string }) {
  const d = estate.data;
  const p = inv.data?.performance;
  const devs = devices.data?.devices ?? [];
  const onboarded = devs.filter((x) => x.in_inventory).length;
  const active = d?.lifecycle.find((l) => l.label === 'active')?.n ?? 0;
  const tone = GRADE_TONE[p?.grade ?? ''] ?? SEV.info;
  const cells: { key: string; label: string; href: string; loading: boolean; value: ReactNode; sub: ReactNode }[] = [
    { key: 'estate', label: 'Asset estate', href: REG, loading: estate.isLoading,
      // Headline is the rolled managed-asset count (apex domain = one asset, the
      // Register / Risk Posture basis); hosts shown alongside so "6 assets" and a
      // 12-host estate never read as a contradiction.
      value: d ? nfmt(d.rolled_total ?? d.total) : '—', sub: d ? <>{nfmt(d.total)} hosts<Dot c={EXT_C} />{nfmt(d.rolled_external ?? d.external.total)} external<Dot c={INT_C} />{nfmt(d.internal.total)} internal</> : 'unavailable' },
    { key: 'health', label: 'Inventory health', href: '/cyber-assurance/risk-posture', loading: inv.isLoading,
      value: p?.score != null ? <span className="inline-flex items-baseline gap-2">{p.score.toFixed(1)}<span className="text-[12px] font-medium text-[#64748B]">/ 100</span><Pill tone={tone}>{tone.label}</Pill></span> : '—',
      sub: p?.score != null ? 'target 85 · see Risk posture' : inv.data ? 'not scored yet' : 'unavailable' },
    { key: 'onboarded', label: 'Onboarded from discovery', href: '/cyber-assurance/asset-discovery', loading: devices.isLoading,
      value: devs.length ? `${pctOf(onboarded, devs.length)}%` : '—', sub: devices.data ? (devs.length ? `${nfmt(onboarded)} of ${nfmt(devs.length)} discovered` : 'nothing discovered yet') : 'unavailable' },
    { key: 'seen', label: 'Seen in last 30 days', href: `${REG}&view=stale`, loading: estate.isLoading,
      value: d?.total ? share(d.coverage.seen_30d, d.total) || '0%' : '—', sub: d ? `${nfmt(d.coverage.seen_30d)} of ${nfmt(d.total)} hosts` : 'unavailable' },
    { key: 'owner', label: 'Owner assigned', href: `${REG}&view=unowned`, loading: estate.isLoading,
      value: d?.total ? share(d.coverage.owner, d.total) || '0%' : '—', sub: d ? `${nfmt(d.coverage.owner)} of ${nfmt(d.total)} hosts` : 'unavailable' },
    { key: 'life', label: 'In active service', href: REG, loading: estate.isLoading,
      value: d?.total ? share(active, d.total) || '0%' : '—', sub: d ? `${nfmt(active)} active · ${nfmt(d.total - active)} other states` : 'unavailable' },
  ];
  return (
    <section aria-label="Estate summary" className={`flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-[#E2E5EC] bg-white lg:flex-row lg:items-stretch ${CARD_SHADOW} ${className}`}>
      <div className="grid min-w-0 flex-1 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {cells.map((c, i) => (
          <Go key={c.key} href={c.href}
            className={`group flex min-w-0 flex-col justify-center px-5 py-2.5 transition hover:bg-[#F6F7FB] ${i ? 'border-l border-[#EEF1F5]' : ''}`}>
            <span className="flex items-center gap-1 truncate text-[11.5px] font-medium text-[#64748B]">{c.label}<ChevronRight size={12} aria-hidden className="text-[#CBD5E1] transition group-hover:translate-x-0.5 group-hover:text-[#64748B]" /></span>
            {c.loading ? <Skel h={24} w="55%" className="my-1" /> : <span className="mt-0.5 truncate text-[22px] font-semibold leading-[1.2] text-[#0F172A]">{c.value}</span>}
            <span className="truncate text-[11.5px] text-[#64748B]">{c.sub}</span>
          </Go>
        ))}
      </div>
      <div className="flex items-center justify-end border-t border-[#EEF1F5] py-2 lg:border-l lg:border-t-0 lg:py-0">{stamp}</div>
    </section>
  );
}
const Dot = ({ c }: { c: string }) => <i aria-hidden className="ml-2.5 mr-1 inline-block h-[7px] w-[7px] rounded-full align-middle first:ml-0" style={{ background: c }} />;

/* ---------- 1b) Fleet compliance score — the per-asset CIS score, rolled up estate-wide ----------
   The inventory's own complaint fix: every asset carries a CIS score (shown inside its detail),
   but the top level never summarised them. This card rolls that per-asset score up to a fleet
   average + grade, a band distribution (incl. assets with no scan), and a worst-first leaderboard
   that links straight into the assets needing work. All from /assets/inventory-overview.fleet_cis. */
/* `c` = the mark/fill colour (distribution bar, dots); `ink` = the AA text colour for the
   score and badges; `bg` = the badge tint. The two greens clear the normal-vision floor
   (ΔE 19.3) and the adjacent-pair CVD floor; band fills always ship beside a text label. */
const BAND: Record<FleetBand, { label: string; range: string; c: string; ink: string; bg: string }> = {
  excellent: { label: 'Excellent', range: '≥ 85', c: T.success, ink: T.success, bg: '#E7F5EE' },
  good: { label: 'Good', range: '70–84', c: '#10B981', ink: '#047857', bg: '#E7F5EE' },
  fair: { label: 'Fair', range: '50–69', c: SEV.medium.c, ink: SEV.medium.ink, bg: SEV.medium.bg },
  poor: { label: 'Poor', range: '< 50', c: SEV.critical.c, ink: SEV.critical.ink, bg: SEV.critical.bg },
};
/** The fleet-average score ring — one confident number, the arc and the number both in the
    band's colour (the number in the darker `ink` for AA), paired with a band label so colour
    is never the only cue. The same visual language as the per-asset score donut. */
function ScoreRing({ score, grade }: { score: number | null; grade: string | null }) {
  const size = 108, sw = 11, r = (size - sw) / 2, circ = 2 * Math.PI * r;
  const band = (grade && BAND[grade as FleetBand]) || null;
  const arcC = band ? band.c : GREY;
  const inkC = band ? band.ink : '#64748B';
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const filled = (pct / 100) * circ;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} stroke="#EEF1F5" />
        {pct > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} stroke={arcC}
          strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round" />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[32px] font-semibold leading-none tabular-nums" style={{ color: inkC }}>{score == null ? '—' : Math.round(score)}</span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-[.09em] text-[#64748B]">out of 100</span>
      </div>
    </div>
  );
}
/* Advisory exposure — assets matched to a published security advisory CVE
   (verdict=affected). Read-only from /advisories/affected-assets; the advisory
   module owns the data. Red alert accent when any asset is affected. */
function AdvisoryExposureCard({ className }: { className: string }) {
  const q = useQuery({
    queryKey: ['advisories', 'affected-assets'],
    queryFn: async () => { try { return (await apiClient.get('/advisories/affected-assets')).data as any; } catch { return null; } },
  });
  const assetsN: number = q.data?.total ?? 0;
  const cveN: number = (q.data?.assets || []).reduce((n: number, a: any) => n + (a.items?.length || 0), 0);
  const hot = assetsN > 0;
  const red = SEV.high.c;
  return (
    <Box title="Advisory exposure" sub="Assets matched to a published security advisory CVE"
      icon={<AlertTriangle size={15} />} accent={hot ? red : T.success} busy={q.isFetching} className={className}>
      <Link href="/cyber-assurance/advisories"
        className="flex items-center gap-7 rounded-[10px] border border-[#E2E5EC] bg-[#FCFDFE] px-4 py-3 no-underline transition-colors hover:bg-[#F6F7FB]">
        <span className="flex flex-col">
          <span className="text-[26px] font-semibold leading-none" style={{ color: hot ? red : '#0F172A' }}>{assetsN}</span>
          <span className="mt-1 text-[11.5px] text-[#64748B]">asset{assetsN !== 1 ? 's' : ''} affected</span>
        </span>
        <span className="h-9 w-px bg-[#E2E5EC]" />
        <span className="flex flex-col">
          <span className="text-[26px] font-semibold leading-none text-[#0F172A]">{cveN}</span>
          <span className="mt-1 text-[11.5px] text-[#64748B]">advisory CVE{cveN !== 1 ? 's' : ''}</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: hot ? red : T.success }}>
          {hot ? 'Review in Advisories' : 'No exposure'} <ArrowRight size={14} />
        </span>
      </Link>
      {hot
        ? <p className="m-0 mt-2.5 text-[11.5px]" style={{ color: red }}>⚠ {assetsN} asset{assetsN !== 1 ? 's are' : ' is'} affected by a published advisory — review and confirm remediation.</p>
        : <p className="m-0 mt-2.5 text-[11.5px] text-[#64748B]">No assets currently match a published security advisory.</p>}
    </Box>
  );
}

function FleetScoreCard({ inv, className }: { inv: Q<InvOverview>; className: string }) {
  const f = inv.data?.fleet_cis;
  const total = f ? f.scanned + f.unscanned : 0;
  let inner: ReactNode;
  if (inv.isLoading) inner = <Loading rows={4} />;
  else if (!f) inner = <Unavailable what="Fleet compliance score" />;
  else if (!f.scanned) inner = (
    <Empty icon={<ShieldCheck size={16} />} title="No asset scores yet"
      body="Run a CIS benchmark scan from the CIS tab — the fleet average, score distribution and the lowest-scoring assets appear here."
      href="/cyber-assurance/assets?tab=cis" cta="Open CIS Benchmark" />
  );
  else {
    const tone = GRADE_TONE[f.grade ?? ''] ?? SEV.info;
    const parts: Part[] = [
      { key: 'excellent', label: BAND.excellent.label, n: f.bands.excellent, c: BAND.excellent.c },
      { key: 'good', label: BAND.good.label, n: f.bands.good, c: BAND.good.c },
      { key: 'fair', label: BAND.fair.label, n: f.bands.fair, c: BAND.fair.c },
      { key: 'poor', label: BAND.poor.label, n: f.bands.poor, c: BAND.poor.c },
      { key: 'unscanned', label: 'Not scanned', n: f.unscanned, c: GREY },
    ];
    const legend: { key: string; label: string; range: string; n: number; c: string }[] = [
      ...(['excellent', 'good', 'fair', 'poor'] as FleetBand[]).map((b) => ({ key: b, label: BAND[b].label, range: BAND[b].range, n: f.bands[b], c: BAND[b].c })),
      { key: 'unscanned', label: 'Not scanned', range: 'no scan', n: f.unscanned, c: GREY },
    ];
    inner = (
      <div className="grid flex-1 grid-cols-1 gap-x-7 gap-y-6 lg:grid-cols-12">
        {/* Fleet average — one confident score */}
        <div className="flex items-center gap-5 lg:col-span-4">
          <ScoreRing score={f.avg} grade={f.grade} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold text-[#0F172A]">Fleet average</span>
              <Pill tone={tone}>{tone.label}</Pill>
            </div>
            <p className="m-0 mt-2 text-[12px] leading-[1.55] text-[#475569]">
              Mean CIS benchmark score across <span className="font-semibold text-[#0F172A]">{nfmt(f.scanned)}</span> scanned {f.scanned === 1 ? 'asset' : 'assets'}
              {f.unscanned > 0 ? <> · <span className="font-semibold text-[#0F172A]">{nfmt(f.unscanned)}</span> not yet scanned</> : null}.
            </p>
          </div>
        </div>
        {/* Distribution — segmented bar + labelled legend */}
        <div className="flex flex-col justify-center lg:col-span-4 lg:border-l lg:border-[#EEF1F5] lg:pl-7">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <ModalEyebrow>Score distribution</ModalEyebrow>
            <span className="text-[11px] tabular-nums text-[#64748B]"><span className="font-semibold text-[#0F172A]">{nfmt(total)}</span> assets</span>
          </div>
          <StackBar parts={parts} label="Assets by score band" height={14} />
          <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-x-6 gap-y-[7px] p-0 sm:grid-cols-2">
            {legend.map((p) => (
              <li key={p.key} className="flex items-center gap-2 text-[12px]">
                <i aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: p.c }} />
                <span className="min-w-0 flex-1 truncate text-[#334155]">{p.label} <span className="text-[#94A3B8]">{p.range}</span></span>
                <span className="shrink-0 font-semibold tabular-nums text-[#0F172A]">{nfmt(p.n)}</span>
                <span className="w-[34px] shrink-0 text-right text-[11px] tabular-nums text-[#64748B]">{share(p.n, total) || '0%'}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Lowest-scoring — score badge + name, each row clickable */}
        <div className="flex min-w-0 flex-col lg:col-span-4 lg:border-l lg:border-[#EEF1F5] lg:pl-7">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <ModalEyebrow>Lowest-scoring assets</ModalEyebrow><MoreLink href={REG}>Register</MoreLink>
          </div>
          {f.worst.length === 0 ? (
            <p className="m-0 text-[12px] text-[#64748B]">No scored assets yet.</p>
          ) : (
            <ul className="m-0 flex flex-1 list-none flex-col p-0">
              {f.worst.map((w) => {
                const b = BAND[w.band];
                return (
                  <li key={w.id} className="border-b border-[#F1F3F7] last:border-0">
                    <Link href={`/cyber-assurance/assets/${w.id}`} className="group flex min-h-[34px] items-center gap-3 py-1 text-[12.5px]">
                      <span aria-hidden className="inline-flex h-[23px] w-[36px] shrink-0 items-center justify-center rounded-[7px] text-[12px] font-semibold tabular-nums"
                        style={{ background: b.bg, color: b.ink }}>{Math.round(w.score)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-[#0F172A] transition group-hover:text-[#005B96]" title={`${w.name}${w.criticality ? ` · ${w.criticality}` : ''}`}>{w.name}</span>
                      {w.criticality && <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-[.03em] text-[#94A3B8]">{w.criticality}</span>}
                      <ChevronRight size={14} aria-hidden className="shrink-0 text-[#CBD5E1] transition group-hover:translate-x-0.5 group-hover:text-[#64748B]" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }
  return (
    <Box title="Asset compliance scores" icon={<ShieldCheck size={15} />} accent={T.base} busy={busy(inv)} className={className}
      sub="Each asset's CIS benchmark score, rolled up across the fleet — average, distribution, and the assets that need work first">
      {inner}
    </Box>
  );
}

/* ---------- 2) External | Internal panels (the SME droplet structure + drill-down depth) ----------
   Two distinct cards, each owning its own aggregations: a by-type / by-infrastructure list and a
   second list (outside-in verification for external, OS family for internal), a coverage-stat
   footer, and — external only — a registrable-domain concentration readout. Each class/OS row opens
   a blur-background pop-up modal: the within-kind breakdown (versions / engines / exposed services),
   governance & hygiene, criticality, and the actual named assets grouped by sub-kind / version. */
/** "11 ×2 · 10 ×1" — the versions behind an OS row, without repeating the family. */
const versions = (o: Sub) => (o.subtypes ?? []).filter((s) => s.label !== o.label)
  .map((s) => `${s.label.replace(/^Windows (Server )?/, '')} ×${nfmt(s.n)}`).slice(0, 3).join(' · ');

type Stat = { label: string; value: string; sub?: string; alarm?: boolean };
type ListSpec =
  | { title: string; mode: 'class'; rows: Cls[] }
  | { title: string; mode: 'os'; rows: Sub[] }
  | { title: string; mode: 'plain'; rows: { label: string; n: number; gap: boolean }[] };

function SidePanel({ kind, q, lists, note, stats, roots, className }: {
  kind: keyof typeof SIDE; q: Q<Estate>; lists: ListSpec[]; note?: string; stats: Stat[]; roots?: Roots; className: string;
}) {
  const s = SIDE[kind];
  const d = q.data;
  const side = d?.[kind];
  const Icon = s.icon;
  const title = (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]" style={{ background: alpha(s.c, 0.1), color: s.c }}><Icon size={16} /></span>
      <span className="min-w-0">
        <span className="block truncate">{s.name}</span>
        <span className="block truncate text-[12px] font-normal text-[#64748B]">{s.blurb}</span>
      </span>
    </span>
  );
  const aside = side ? (
    <div className="flex shrink-0 flex-col items-end">
      <span className="text-[28px] font-semibold leading-none text-[#0F172A]">{nfmt(side.total)}</span>
      <span className="mt-1 flex items-center gap-3 text-[12px] text-[#64748B]">{share(side.total, d!.total) || '0%'} of estate<MoreLink href={`${REG}&view=${s.view}`}>Register</MoreLink></span>
    </div>
  ) : null;
  let body: ReactNode;
  if (q.isLoading) body = <div className="grid flex-1 grid-cols-2 gap-7">{[0, 1].map((i) => <Loading key={i} rows={6} />)}</div>;
  else if (!d || !side) body = <Unavailable what={s.name} />;
  else if (!side.total) body = (
    <Empty icon={kind === 'external' ? <Globe size={16} /> : <Server size={16} />}
      title={kind === 'external' ? 'No external assets yet' : 'No internal assets yet'}
      body={kind === 'external' ? 'Run an external (outside-in) discovery to map your attack surface.' : 'Connect a host from Discovery or import a register to see types and operating systems here.'}
      href="/cyber-assurance/asset-discovery" cta="Open Discovery" />
  );
  else body = (
    <>
      <div className="grid flex-1 grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {lists.map((l) => <PanelList key={l.title} spec={l} total={side.total} color={s.c} where={kind} />)}
      </div>
      {note && <p className="m-0 mt-1.5 truncate text-[11.5px] text-[#94A3B8]" title={note}>{note}</p>}
      {roots && roots.distinct > 0 && (
        <div className="mt-3 border-t border-[#EEF1F5] pt-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <Eyebrow>Surface concentration</Eyebrow>
            <span className="text-[11px] text-[#64748B]">{nfmt(roots.named)} names · {nfmt(roots.distinct)} registrable {roots.distinct === 1 ? 'domain' : 'domains'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roots.top.map((r) => (
              <span key={r.label} title={`${r.label}: ${plural(r.n, 'name')}`} className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-[#E6EAF0] bg-white px-2 py-[3px] text-[11px]">
                <span className="max-w-[160px] truncate font-medium text-[#334155]">{r.label}</span><b className="tabular-nums text-[#0F172A]">{nfmt(r.n)}</b>
              </span>
            ))}
            {roots.more > 0 && <span className="inline-flex items-center rounded-[7px] bg-[#F1F5F9] px-2 py-[3px] text-[11px] font-medium text-[#64748B]">+{nfmt(roots.more)} more</span>}
          </div>
        </div>
      )}
      <dl className="m-0 mt-3 grid grid-cols-2 border-t border-[#EEF1F5] pt-3 md:grid-cols-4">
        {stats.map((st, i) => (
          <div key={st.label} className={`min-w-0 px-3 first:pl-0 ${i ? 'md:border-l md:border-[#EEF1F5]' : ''}`}>
            <dt className="truncate text-[11.5px] text-[#64748B]">{st.label}</dt>
            <dd className="m-0 mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[18px] font-semibold leading-[1.25]" style={{ color: st.alarm ? SEV.critical.ink : T.text }}>
              {st.alarm && <AlertTriangle size={14} aria-label="Needs attention" className="self-center" />}{st.value}
              {st.sub && <span className="truncate text-[11.5px] font-normal text-[#64748B]">{st.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
  return <Box title={title} aside={aside} accent={s.c} busy={busy(q)} className={className}>{body}</Box>;
}
/** A fixed-taxonomy list on its own scale (longest bar = this list's largest bucket, so a
    2-asset side reads as clearly as a 243-asset one). Class and OS rows are drill-down
    disclosures; outside-in verification rows are plain. */
function PanelList({ spec, total, color, where }: { spec: ListSpec; total: number; color: string; where: 'external' | 'internal' }) {
  const max = Math.max(1, ...spec.rows.map((r) => (r as { n: number }).n));
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-0.5 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[#94A3B8]">
        <span className="min-w-0 flex-1 truncate">{spec.title}</span><span className="w-[40px] text-right">No.</span><span className="w-[40px] text-right">Share</span><span className="w-[16px] shrink-0" />
      </div>
      <ul className="m-0 flex flex-1 list-none flex-col p-0">
        {spec.mode === 'class' && spec.rows.map((c) => <ClassBar key={c.label} cls={c} total={total} max={max} color={color} where={where} />)}
        {spec.mode === 'os' && spec.rows.map((o) => <OsBar key={o.label} os={o} total={total} max={max} color={color} />)}
        {spec.mode === 'plain' && spec.rows.map((r) => <PlainBar key={r.label} row={r} total={total} max={max} color={color} />)}
      </ul>
    </div>
  );
}
/** Clean two-line bar row — the row content (and, where expandable, the modal trigger's face).
    A chevron marks the rows that open a drill-down pop-up. */
function BarRowBody({ label, n, total, max, gap, color, expandable }: {
  label: ReactNode; n: number; total: number; max: number; gap: boolean; color: string; expandable: boolean;
}) {
  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className={`min-w-0 flex-1 truncate text-[12.5px] ${n ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}>{label}</span>
        <span className={`w-[40px] text-right text-[13px] font-semibold tabular-nums ${n ? 'text-[#0F172A]' : 'text-[#CBD5E1]'}`}>{nfmt(n)}</span>
        <span className="w-[40px] text-right text-[12px] tabular-nums text-[#64748B]">{n ? share(n, total) : '—'}</span>
        {expandable ? <ChevronRight size={13} aria-hidden className="w-[16px] shrink-0 text-[#94A3B8]" /> : <span className="w-[16px] shrink-0" />}
      </div>
      <div className="h-[6px] rounded-full bg-[#F1F4F8]">
        {n > 0 && <div className="h-full min-w-[6px] rounded-full" style={{ width: `${(n / max) * 100}%`, background: gap ? GREY : color }} />}
      </div>
    </>
  );
}
const triggerCls = 'flex w-full min-h-[31px] cursor-pointer flex-col justify-center gap-[4px] rounded-[6px] px-1.5 text-left transition hover:bg-[#F3F7FB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#005B96]';

/** Right-side slide-over drawer: a dim+blur scrim over the whole dashboard and a full-height white
    panel that slides in from the right, its body scrolling internally. Click-scrim / Esc / X closes.
    Rendered in a <body> portal so the dashboard's zoom:0.8 and .assets-light colour scope don't touch
    it. Roomy padding + a clear header (title · one-line summary · close) replace the old cramped pop-up. */
function DrillModal({ color, title, meta, onClose, children }: {
  color: string; title: ReactNode; meta?: ReactNode; onClose: () => void; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div data-inv-modal role="presentation" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', justifyContent: 'flex-end',
               background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)',
               fontFamily: FONT, animation: 'invScrimIn .18s ease-out' }}>
      <style>{MODAL_CSS}</style>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(500px, 100%)', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                 background: '#fff', borderLeft: `3px solid ${color}`, boxShadow: '-24px 0 64px rgba(15,23,42,0.22)',
                 animation: 'invDrawerIn .24s cubic-bezier(.22,.61,.36,1)' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 22px 16px', borderBottom: '1px solid #EEF1F5' }}>
          <span aria-hidden style={{ width: 12, height: 12, borderRadius: 4, background: color, marginTop: 4, flex: 'none' }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#0F172A', lineHeight: 1.3 }}>{title}</div>
            {meta && <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 3, lineHeight: 1.4 }}>{meta}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, flex: 'none', borderRadius: 8, border: '1px solid #E2E5EC', background: '#fff', color: '#334155', cursor: 'pointer' }}>
            <X size={16} aria-hidden />
          </button>
        </header>
        <div style={{ overflowY: 'auto', padding: '20px 22px 24px' }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
/** One well-separated section inside the drawer: a divider + generous spacing above (unless `first`),
    an optional small-caps title with an optional right-aligned aside. Keeps the drawer's sections
    from running together the way the old cramped mt-3 blocks did. */
function ModalSection({ title, aside, first, children }: { title?: ReactNode; aside?: ReactNode; first?: boolean; children: ReactNode }) {
  return (
    <section className={first ? '' : 'mt-5 border-t border-[#EEF1F5] pt-5'}>
      {title != null && (
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <ModalEyebrow>{title}</ModalEyebrow>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** The set of sub-kind / version labels that are past vendor end-of-life — so the asset list can
    flag the version groups whose machines carry an end-of-life OS/engine. */
const eolSubs = (subs?: Sub[]) => new Set((subs ?? []).filter((s) => (s.eol_past ?? 0) > 0).map((s) => s.label));

/** The real machines/hosts/domains, as a proper list (no loose chips): grouped by the sub-kind /
    version they fall under, each group a bordered block with a header (version · count · an
    end-of-life badge where the version is past support) over one clean row per asset — name bold &
    dark, criticality as a labelled status, the whole row clickable to its detail where an id exists.
    Larger sets link out to the register. Honest empty state when no names are recorded. */
function AssetList({ samples, total, where, eol }: { samples?: Sample[]; total: number; where: 'external' | 'internal'; eol?: Set<string> }) {
  const list = samples ?? [];
  const groups: { sub: string; items: Sample[] }[] = [];
  const idx = new Map<string, number>();
  for (const s of list) {
    const k = s.sub || 'Other';
    let i = idx.get(k);
    if (i === undefined) { i = groups.length; idx.set(k, i); groups.push({ sub: k, items: [] }); }
    groups[i].items.push(s);
  }
  const critTone = (c?: string): Tone | null => (c ? (SEV as Record<string, Tone>)[c] ?? null : null);
  if (list.length === 0) return <p className="m-0 text-[12px] text-[#64748B]">No named assets recorded for this group.</p>;
  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-3">
        {groups.map((g) => {
          const past = eol?.has(g.sub);
          return (
            <div key={g.sub} className="overflow-hidden rounded-[10px] border border-[#E6EAF0]">
              <div className="flex items-center gap-2 border-b border-[#EEF1F5] bg-[#F8FAFC] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#0F172A]">{g.sub}</span>
                {past && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[2px] text-[10.5px] font-semibold"
                    style={{ background: SEV.critical.bg, color: SEV.critical.ink }}>
                    <AlertTriangle size={11} aria-hidden /> End-of-life
                  </span>
                )}
                <span className="shrink-0 text-[11px] tabular-nums text-[#64748B]"><span className="font-semibold text-[#0F172A]">{nfmt(g.items.length)}</span> {g.items.length === 1 ? 'asset' : 'assets'}</span>
              </div>
              <ul className="m-0 list-none p-0">
                {g.items.map((s, i) => {
                  const t = critTone(s.crit);
                  const inner = (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#0F172A] group-hover:text-[#005B96]">{s.name}</span>
                      {t && (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-[#64748B]">
                          <i aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: t.c }} />{t.label}
                        </span>
                      )}
                    </>
                  );
                  return (
                    <li key={s.id != null ? `${s.id}-${i}` : `n-${i}`} className="border-t border-[#F1F4F8] first:border-t-0">
                      {s.id != null ? (
                        <Link href={`/cyber-assurance/assets/${s.id}`} title={`${s.name}${s.crit ? ` · ${s.crit}` : ''}`}
                          className="group flex items-center gap-3 px-3 py-[8px] transition hover:bg-[#F6F9FC]">
                          {inner}
                          <ChevronRight size={13} aria-hidden className="shrink-0 text-[#CBD5E1] transition group-hover:translate-x-0.5 group-hover:text-[#64748B]" />
                        </Link>
                      ) : (
                        <div className="group flex items-center gap-3 px-3 py-[8px]" title={s.name}>
                          {inner}<span aria-hidden className="w-[13px] shrink-0" />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {total > list.length && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-[#64748B]"><span className="font-semibold text-[#0F172A]">{nfmt(list.length)}</span> of {nfmt(total)} shown</span>
          <MoreLink href={`${REG}&view=${where}`}>View all in the register</MoreLink>
        </div>
      )}
    </div>
  );
}

function ClassBar({ cls, total, max, color, where }: { cls: Cls; total: number; max: number; color: string; where: 'external' | 'internal' }) {
  const [open, setOpen] = useState(false);
  const subs = (cls.subtypes ?? []).filter((s) => s.n > 0);
  const row = <BarRowBody label={cls.label} n={cls.n} total={total} max={max} gap={cls.gap} color={color} expandable={cls.n > 0} />;
  if (cls.n === 0) return <li className="flex min-h-[31px] flex-col justify-center gap-[4px] px-1.5" title={`${cls.label}: 0`}>{row}</li>;
  return (
    <li>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={triggerCls}>{row}</button>
      {open && (
        <DrillModal color={color} onClose={() => setOpen(false)} title={cls.label}
          meta={<>{nfmt(cls.n)} {cls.n === 1 ? 'asset' : 'assets'} · {share(cls.n, total) || '0%'} of {where === 'external' ? 'external surface' : 'internal estate'}</>}>
          <ModalSection first title={where === 'internal' ? 'OS / engine in this class' : 'Exposure in this class'}>
            <SubBreakdown subs={subs} color={color} />
          </ModalSection>
          <ModalSection title="Coverage & hygiene"><CoverageStrip cls={cls} side={where} /></ModalSection>
          <ModalSection><CritMini crit={cls.crit} n={cls.n} /></ModalSection>
          <ModalSection title="Named assets">
            <AssetList samples={cls.samples} total={cls.n} where={where} eol={eolSubs(cls.subtypes)} />
          </ModalSection>
        </DrillModal>
      )}
    </li>
  );
}
function OsBar({ os, total, max, color }: { os: Sub; total: number; max: number; color: string }) {
  const [open, setOpen] = useState(false);
  const vers = (os.subtypes ?? []).filter((v) => v.n > 0 && v.label !== os.label);
  const suffix = versions(os);
  const label = <>{os.label}{suffix ? <span className="text-[11.5px] text-[#64748B]"> · {suffix}</span> : null}</>;
  const openable = os.n > 0 && (vers.length > 0 || (os.samples?.length ?? 0) > 0);
  const row = <BarRowBody label={label} n={os.n} total={total} max={max} gap={os.gap} color={color} expandable={openable} />;
  if (!openable) return <li className="flex min-h-[31px] flex-col justify-center gap-[4px] px-1.5" title={`${os.label}: ${nfmt(os.n)}${suffix ? ` (${suffix})` : ''}`}>{row}</li>;
  return (
    <li>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={triggerCls}>{row}</button>
      {open && (
        <DrillModal color={color} onClose={() => setOpen(false)} title={os.label}
          meta={<>{nfmt(os.n)} {os.n === 1 ? 'host' : 'hosts'}{(os.eol_past ?? 0) > 0 ? <> · <span style={{ color: SEV.critical.ink, fontWeight: 600 }}>{nfmt(os.eol_past)} past end-of-life</span></> : null}</>}>
          <ModalSection first title="Versions in use"><SubBreakdown subs={vers} color={color} /></ModalSection>
          <ModalSection title="Named assets">
            <AssetList samples={os.samples} total={os.n} where="internal" eol={eolSubs(vers)} />
          </ModalSection>
        </DrillModal>
      )}
    </li>
  );
}
function PlainBar({ row, total, max, color }: { row: { label: string; n: number; gap: boolean }; total: number; max: number; color: string }) {
  return (
    <li className="flex min-h-[31px] flex-col justify-center gap-[4px] px-1.5" title={`${row.label}: ${nfmt(row.n)} · ${share(row.n, total) || '0%'}`}>
      <BarRowBody label={row.label} n={row.n} total={total} max={max} gap={row.gap} color={color} expandable={false} />
    </li>
  );
}
function SubBreakdown({ subs, color }: { subs: Sub[]; color: string }) {
  if (!subs.length) return <p className="m-0 text-[12px] text-[#64748B]">Not profiled yet.</p>;
  const max = Math.max(1, ...subs.map((s) => s.n));
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {subs.map((s) => (
        <li key={s.label} className="flex items-center gap-2.5 text-[12px]" title={(s.eol_past ?? 0) > 0 ? `${s.label}: ${s.eol_past} past vendor end-of-life` : s.label}>
          <span className="min-w-0 flex-1 truncate" style={{ color: s.gap ? '#64748B' : '#334155' }}>{s.label}</span>
          {(s.eol_past ?? 0) > 0 && (
            <span className="inline-flex shrink-0 items-center rounded-full px-1.5 py-[1px] text-[10px] font-semibold tabular-nums"
              style={{ background: SEV.critical.bg, color: SEV.critical.ink }} title={`${s.eol_past} past end-of-life`}>EOL {nfmt(s.eol_past)}</span>
          )}
          <span className="h-[6px] w-[56px] shrink-0 overflow-hidden rounded-full bg-[#EEF1F5]">
            <span className="block h-full rounded-full" style={{ width: `${(s.n / max) * 100}%`, minWidth: s.n > 0 ? 3 : 0, background: s.gap ? GREY : color }} />
          </span>
          <span className="w-[34px] shrink-0 text-right font-semibold tabular-nums text-[#0F172A]">{nfmt(s.n)}</span>
        </li>
      ))}
    </ul>
  );
}
function Mini({ label, value, alarm }: { label: ReactNode; value: ReactNode; alarm?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="m-0 truncate text-[10.5px] font-medium uppercase tracking-[.04em] text-[#64748B]">{label}</p>
      <p className="m-0 mt-0.5 text-[14px] font-semibold leading-[1.2] tabular-nums" style={{ color: alarm ? SEV.critical.ink : '#0F172A' }}>{value}</p>
    </div>
  );
}
function CoverageStrip({ cls, side }: { cls: Cls; side: 'external' | 'internal' }) {
  const metrics: { label: string; value: ReactNode; alarm?: boolean }[] = [
    { label: 'Seen ≤30d', value: share(cls.seen_30d, cls.n) || '0%' },
    { label: 'Owner', value: share(cls.owner, cls.n) || '0%', alarm: cls.owner < cls.n },
  ];
  if (side === 'internal') {
    if (cls.cis != null) metrics.push({ label: 'CIS', value: share(cls.cis, cls.n) || '0%' });
    if (cls.eol) metrics.push({ label: 'Past EOL', value: nfmt(cls.eol.past), alarm: cls.eol.past > 0 });
  }
  return <div className="grid grid-cols-2 gap-x-5 gap-y-3 min-[380px]:grid-cols-4 sm:grid-cols-2">{metrics.map((m) => <Mini key={m.label} {...m} />)}</div>;
}
function CritMini({ crit, n }: { crit: Crit; n: number }) {
  const parts: Part[] = CRIT.map((x) => ({ key: x.k, label: x.label, n: crit[x.k] ?? 0, c: x.c }));
  const rated = parts.filter((p) => p.key !== 'unrated').reduce((s, p) => s + p.n, 0);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <ModalEyebrow>Criticality</ModalEyebrow>
        <span className="text-[11px] tabular-nums text-[#64748B]"><span className="font-semibold text-[#0F172A]">{nfmt(rated)}</span> of {nfmt(n)} rated</span>
      </div>
      <StackBar parts={parts} label="Criticality mix" height={10} />
      <ul className="m-0 mt-2.5 grid list-none grid-cols-2 gap-x-5 gap-y-1 p-0 min-[400px]:grid-cols-3">
        {parts.filter((p) => p.n > 0).map((p) => (
          <li key={p.key} className="flex items-center gap-1.5 text-[11.5px]">
            <i aria-hidden className="inline-block h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: p.c }} />
            <span className="text-[#64748B]">{p.label}</span>
            <b className="ml-auto font-semibold tabular-nums text-[#0F172A]">{nfmt(p.n)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- 3) Asset-class matrix (SME droplet card, restored verbatim) ---------- */
function ClassMatrix({ q, className }: { q: Q<Estate>; className: string }) {
  const d = q.data;
  let body: ReactNode;
  if (q.isLoading) body = <Loading rows={8} />;
  else if (!d) body = <Unavailable what="Asset-class matrix" />;
  else if (!d.total) body = <Empty icon={<Layers size={16} />} title="No asset classes yet" body="Coverage by class appears once assets are in the inventory." href="/cyber-assurance/asset-discovery" cta="Bring assets in" />;
  else body = (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[820px] table-fixed border-collapse text-[12.5px]">
        <colgroup><col /><col className="w-[62px]" /><col className="w-[56px]" /><col className="w-[94px]" /><col className="w-[94px]" /><col className="w-[94px]" /><col className="w-[136px]" /><col className="w-[104px]" /></colgroup>
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#94A3B8]">
            <th className="pb-2 pl-3 text-left font-semibold">Asset class</th>
            <th className="pb-2 text-right font-semibold">Assets</th>
            <th className="pb-2 text-right font-semibold">Share</th>
            <th className="pb-2 text-right font-semibold" title="Seen by a scan or collector in the last 30 days">Seen ≤30d</th>
            <th className="pb-2 text-right font-semibold" title="Has an owner assigned">Owner</th>
            <th className="pb-2 text-right font-semibold" title="Has a CIS benchmark scan (host assets only)">CIS scan</th>
            <th className="pb-2 pl-4 text-left font-semibold">Criticality</th>
            <th className="pb-2 pr-3 text-right font-semibold" title="Vendor end-of-support of the detected OS, or the register's EOL date">End-of-life</th>
          </tr>
        </thead>
        <SideRows kind="external" side={d.external} estate={d.total} />
        <SideRows kind="internal" side={d.internal} estate={d.total} />
      </table>
    </div>
  );
  return (
    <Box title="Asset-class matrix" sub="Coverage and assurance for every class — the register, summarised" busy={busy(q)} className={className}
      aside={<div className="flex shrink-0 items-center gap-4">
        {d?.total ? <span className="hidden items-center gap-2.5 text-[11px] text-[#64748B] 2xl:inline-flex">{CRIT.map((x) => <span key={x.k} className="inline-flex items-center gap-1"><Key c={x.c} />{x.label}</span>)}</span> : null}
        <MoreLink href={REG}>Open register</MoreLink>
      </div>}>
      {body}
    </Box>
  );
}

const sumCrit = (cs: Cls[]): Crit => cs.reduce((acc, c) => { CRIT.forEach(({ k }) => { acc[k] += c.crit[k]; }); return acc; },
  { critical: 0, high: 0, medium: 0, low: 0, unrated: 0 } as Crit);

function SideRows({ kind, side, estate }: { kind: keyof typeof SIDE; side: Side; estate: number }) {
  const s = SIDE[kind];
  const external = kind === 'external';
  const present = side.classes.filter((c) => c.n > 0);
  const none = side.classes.filter((c) => c.n === 0).map((c) => c.label);
  const sum = (k: 'seen_30d' | 'owner') => present.reduce((acc, c) => acc + c[k], 0);
  const eol = external ? null : present.reduce((acc, c) => ({ past: acc.past + (c.eol?.past ?? 0), soon: acc.soon + (c.eol?.soon ?? 0), known: acc.known + (c.eol?.known ?? 0) }), { past: 0, soon: 0, known: 0 });
  const cell = 'py-2';
  return (
    <tbody>
      <tr className="font-semibold" style={{ background: alpha(s.c, 0.06) }}>
        <td className={`${cell} rounded-l-[8px] pl-3`} style={{ boxShadow: `inset 4px 0 0 ${s.c}` }}>
          <span className="flex items-center gap-2 text-[12px] uppercase tracking-[.06em] text-[#0F172A]">
            <s.icon size={13} aria-hidden style={{ color: s.c }} />{external ? 'External' : 'Internal'}
            {none.length > 0 && <span className="truncate text-[11px] font-normal normal-case tracking-normal text-[#94A3B8]" title={`None found: ${none.join(', ')}`}>· {none.length} of {side.classes.length} classes empty</span>}
          </span>
        </td>
        <td className={`${cell} text-right tabular-nums`}>{nfmt(side.total)}</td>
        <td className={`${cell} text-right tabular-nums text-[#64748B]`}>{share(side.total, estate) || '0%'}</td>
        <td className={cell}><Pct n={sum('seen_30d')} d={side.total} /></td>
        <td className={cell}><Pct n={sum('owner')} d={side.total} /></td>
        <td className={cell}><Pct n={external ? null : present.reduce((acc, c) => acc + (c.cis ?? 0), 0)} d={side.total} /></td>
        <td className={`${cell} pl-4`}><CritMix c={sumCrit(present)} /></td>
        <td className={`${cell} rounded-r-[8px] pr-3 text-right`}><EolCell e={eol} n={side.total} /></td>
      </tr>
      {present.map((c) => (
        <tr key={c.label} className="border-b border-[#F1F3F7]">
          <td className="py-1.5 pl-3 pr-3">
            <span className={`block truncate font-medium ${c.gap ? 'text-[#64748B]' : 'text-[#0F172A]'}`}>{c.label}</span>
            {/* One line of whole subtype chips; the full breakdown is in the tooltip. */}
            <span className="mt-0.5 flex h-[17px] flex-wrap gap-x-1.5 overflow-hidden text-[11.5px] leading-[17px] text-[#64748B]" title={c.subtypes.map((x) => `${x.label}: ${nfmt(x.n)}`).join(' · ')}>
              {c.subtypes.map((x, i) => <span key={x.label} className="whitespace-nowrap">{i > 0 && '· '}{x.label} <b className="font-semibold text-[#334155]">{nfmt(x.n)}</b></span>)}
            </span>
          </td>
          <td className="py-1.5 text-right font-semibold tabular-nums">{nfmt(c.n)}</td>
          <td className="py-1.5 text-right tabular-nums text-[#64748B]">{share(c.n, side.total)}</td>
          <td className="py-1.5"><Pct n={c.seen_30d} d={c.n} /></td>
          <td className="py-1.5"><Pct n={c.owner} d={c.n} /></td>
          <td className="py-1.5"><Pct n={c.cis} d={c.n} /></td>
          <td className="py-1.5 pl-4"><CritMix c={c.crit} /></td>
          <td className="py-1.5 pr-3 text-right"><EolCell e={c.eol} n={c.n} /></td>
        </tr>
      ))}
    </tbody>
  );
}

function Pct({ n, d }: { n: number | null; d: number }) {
  if (n == null) return <span className="block text-right text-[12px] text-[#94A3B8]" title="Host benchmarks don't apply to outside-in assets">n/a</span>;
  if (!d) return <span className="block text-right text-[#CBD5E1]">—</span>;
  return (
    <span className="flex items-center justify-end gap-2" title={`${nfmt(n)} of ${nfmt(d)}`}>
      <span className="h-[5px] w-[40px] rounded-full bg-[#EEF1F5]"><span className="block h-full rounded-full" style={{ width: `${pctOf(n, d)}%`, background: T.base }} /></span>
      <span className="w-[38px] text-right tabular-nums">{share(n, d) || '0%'}</span>
    </span>
  );
}

function CritMix({ c }: { c: Crit }) {
  const parts = CRIT.filter((x) => c[x.k] > 0);
  if (!parts.length) return <span className="text-[#CBD5E1]">—</span>;
  const top = [...parts].sort((a, b) => c[b.k] - c[a.k])[0];
  return (
    <span className="flex items-center gap-2" title={parts.map((x) => `${x.label} ${nfmt(c[x.k])}`).join(' · ')}>
      <span className="flex h-[8px] w-[48px] shrink-0 gap-[2px]">
        {parts.map((x) => <span key={x.k} className="min-w-[3px] rounded-[2px]" style={{ flex: `${c[x.k]} 1 0px`, background: x.c }} />)}
      </span>
      <span className="truncate text-[12px] text-[#475569]">{top.label}{parts.length > 1 ? ` +${parts.length - 1}` : ''}</span>
    </span>
  );
}

function EolCell({ e, n }: { e: Eol | null; n: number }) {
  if (!e) return <span className="text-[12px] text-[#94A3B8]" title="OS end-of-life isn't observable from outside">n/a</span>;
  if (!n) return <span className="text-[#CBD5E1]">—</span>;
  if (!e.known) return <span className="text-[12px] text-[#94A3B8]" title="No EOL date on the register and no OS the vendor table covers">not tracked</span>;
  if (!e.past && !e.soon) return <span className="text-[12px] text-[#475569]" title={`End-of-life known for ${nfmt(e.known)} of ${nfmt(n)} — none past or due within 90 days`}>In support</span>;
  return (
    <span className="whitespace-nowrap text-[12px]" title={`End-of-life known for ${nfmt(e.known)} of ${nfmt(n)}`}>
      {e.past > 0 && <b className="font-semibold" style={{ color: SEV.critical.ink }}>{nfmt(e.past)} past</b>}
      {e.past > 0 && e.soon > 0 && ' · '}
      {e.soon > 0 && <b className="font-semibold" style={{ color: SEV.high.ink }}>{nfmt(e.soon)} ≤90d</b>}
    </span>
  );
}

/* ---------- 3a-bis) Software & versions across the estate ---------- */
function SoftwareCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="Software & versions" icon={<Package size={15} />} sub="Products running across the estate — databases, web & app servers and applications — with their versions and host counts" busy={busy(q)} className={className}
      aside={<MoreLink href={`${REG}&view=internal`}>Internal</MoreLink>}>
      {body(q, 'Software', (d) => {
        const sw = d.software;
        const inst = sw?.top ?? [];
        const ext = sw?.external?.top ?? [];
        if (!inst.length && !ext.length) {
          return <Empty icon={<Package size={16} />} title="No software inventory yet" body="Installed software and versions appear once internal hosts are read with credentials or report through an agent; internet-facing tech is read from service banners." href="/cyber-assurance/asset-discovery" cta="Open Discovery" />;
        }
        return (
          <div className={`flex flex-1 flex-col gap-3 ${inst.length && ext.length ? 'justify-between' : 'justify-center'}`}>
            {inst.length > 0 && (
              <div className="flex flex-col">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <Eyebrow>Installed on internal hosts</Eyebrow>
                  <span className="text-[11px] font-medium text-[#64748B]">{plural(sw!.products, 'product')} · {plural(sw!.hosts_reporting, 'host')}</span>
                </div>
                <SwGrid rows={inst} more={sw!.more} unit="host" />
              </div>
            )}
            {ext.length > 0 && (
              <div className={`flex flex-col ${inst.length ? 'border-t border-[#EEF1F5] pt-3' : ''}`}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <Eyebrow>Internet-facing service software</Eyebrow>
                  <span className="text-[11px] font-medium text-[#64748B]">{plural(sw!.external.products, 'product')} · {plural(sw!.external.sites, 'site')}</span>
                </div>
                <SwGrid rows={ext} more={sw!.external.more} unit="site" />
              </div>
            )}
          </div>
        );
      }, 7)}
    </Box>
  );
}
/** Dense two-column product rows (name · version chip · count badge). Far shorter than a tall
    stack of full-width bars, which let this card dwarf its row-partner. */
function SwGrid({ rows, more, unit }: { rows: SwRow[]; more: number; unit: string }) {
  return (
    <>
      <ul className="m-0 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2">
        {rows.map((s) => (
          <li key={s.key} className="flex items-center gap-2 border-b border-[#F1F4F8] py-[5px] text-[12px]" title={`${s.label}${s.version ? ` ${s.version}` : ''} · ${plural(s.n, unit)}`}>
            <span className="min-w-0 flex-1 truncate text-[#334155]">{s.label}</span>
            {s.version && <span className="shrink-0 rounded bg-[#EEF1F5] px-1 text-[10px] font-medium tabular-nums text-[#475569]">{s.version}</span>}
            <span className="inline-flex min-w-[24px] shrink-0 items-center justify-center rounded-[5px] bg-[#EAF2F8] px-1.5 text-[11px] font-semibold tabular-nums text-[#005B96]">{nfmt(s.n)}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="m-0 mt-1.5 text-[11px] font-medium text-[#64748B]">+{nfmt(more)} more {more === 1 ? 'product' : 'products'}</p>}
    </>
  );
}

/* ---------- 3b) Business criticality & data sensitivity ---------- */
function ClassificationCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="Criticality & data sensitivity" icon={<Activity size={15} />} sub="Business criticality rating and data classification across the estate" busy={busy(q)} className={className}>
      {body(q, 'Classification', (d) => {
        const crit = d.governance?.criticality;
        const parts: Part[] = CRIT.map((x) => ({ key: x.k, label: x.label, n: crit?.[x.k] ?? 0, c: x.c }));
        const rated = parts.filter((p) => p.key !== 'unrated').reduce((s, p) => s + p.n, 0);
        const dc = d.governance?.data_classification;
        return (
          <div className="flex flex-1 flex-col">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <Eyebrow>Business criticality</Eyebrow>
              <span className="text-[11px] text-[#64748B]">{nfmt(rated)} of {nfmt(d.total)} rated</span>
            </div>
            <StackBar parts={parts} label="Assets by criticality" height={12} />
            <div className="mt-2.5"><PartLegend parts={parts} total={d.total} cols={2} /></div>
            <div className="mt-3 flex flex-1 flex-col border-t border-[#EEF1F5] pt-3">
              <Eyebrow>Data classification</Eyebrow>
              {dc && dc.some((r) => r.n > 0)
                ? <BarList fill rows={bars(dc)} />
                : <p className="m-0 text-[11.5px] text-[#64748B]">No data classification recorded yet.</p>}
            </div>
          </div>
        );
      })}
    </Box>
  );
}

/* ---------- 3c) Lifecycle & environment ---------- */
const LIFE_LABELS: Record<string, string> = {
  planned: 'Planned', active: 'Active', maintenance: 'Maintenance', decommissioned: 'Decommissioned',
  retired: 'Retired', inactive: 'Inactive', unset: 'Not set',
};
function LifecycleCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="Lifecycle & environment" icon={<Radar size={15} />} sub="Where each asset sits in its service life, and which environment it runs in" busy={busy(q)} className={className}>
      {body(q, 'Lifecycle', (d) => {
        const life = (d.lifecycle ?? []).map((l) => ({ label: LIFE_LABELS[l.label] ?? l.label, n: l.n, gap: l.label === 'unset' }));
        const env = d.governance?.environment;
        return (
          <div className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col">
              <Eyebrow>Lifecycle state</Eyebrow>
              {life.length ? <BarList fill rows={bars(life)} /> : <p className="m-0 text-[11.5px] text-[#64748B]">No lifecycle data.</p>}
            </div>
            <div className="mt-3 flex flex-1 flex-col border-t border-[#EEF1F5] pt-3">
              <Eyebrow>Deployment environment</Eyebrow>
              {env && env.some((r) => r.n > 0)
                ? <BarList fill rows={bars(env)} />
                : <p className="m-0 text-[11.5px] text-[#64748B]">No environment tagged yet.</p>}
            </div>
          </div>
        );
      })}
    </Box>
  );
}

/* ---------- 4a) Ownership & accountability ---------- */
function OwnershipCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="Ownership & accountability" icon={<Users size={15} />} sub="Who owns the estate — and how much of it has no owner" busy={busy(q)} className={className}
      aside={<MoreLink href={`${REG}&view=unowned`}>Unowned</MoreLink>}>
      {body(q, 'Ownership', (d) => {
        const o = d.ownership;
        const owned = o?.owned ?? d.coverage.owner;
        const unowned = o?.unowned ?? (d.total - d.coverage.owner);
        const parts: Part[] = [
          { key: 'owned', label: 'Has an owner', n: owned, c: T.base },
          { key: 'un', label: 'No owner', n: unowned, c: GREY },
        ];
        return (
          <div className="flex flex-1 flex-col justify-center">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <Fig label="Owner assigned" value={share(owned, d.total) || '0%'} sub={`${nfmt(owned)} of ${nfmt(d.total)} assets`} />
              <Fig label="Without an owner" value={nfmt(unowned)} sub="need an accountable owner" alarm={unowned > 0} />
            </div>
            <div className="mt-3"><StackBar parts={parts} label="Ownership coverage" /></div>
            <div className="mt-2"><PartLegend parts={parts} total={d.total} cols={2} /></div>
            <div className="mt-3 border-t border-[#EEF1F5] pt-3">
              <Eyebrow>Largest owning teams</Eyebrow>
              {o?.teams && o.teams.length
                ? <BarList rows={bars(o.teams)} />
                : <p className="m-0 text-[11.5px] text-[#64748B]">No owning team or department recorded yet.</p>}
            </div>
          </div>
        );
      })}
    </Box>
  );
}

/* ---------- 4b) Provenance — how assets entered the inventory ---------- */
function ProvenanceCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="How assets entered" icon={<Boxes size={15} />} sub="Provenance of the estate — how each asset was first discovered or added" busy={busy(q)} className={className}>
      {body(q, 'Provenance', (d) => {
        const p = d.provenance;
        const managed = p?.managed ?? 0, discovered = p?.discovered ?? 0, baseline = p?.baseline ?? 0;
        const parts: Part[] = [
          { key: 'managed', label: 'Operator-confirmed', n: managed, c: T.base },
          { key: 'disc', label: 'Auto-discovered', n: discovered, c: '#7FA7C9' },
          { key: 'base', label: 'Pre-existing / manual', n: baseline, c: GREY },
        ];
        return (
          <div className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col">
              <Eyebrow>Origin</Eyebrow>
              {p?.origin && p.origin.some((r) => r.n > 0)
                ? <BarList fill rows={bars(p.origin)} />
                : <p className="m-0 text-[11.5px] text-[#64748B]">Origin not recorded for any asset yet.</p>}
            </div>
            <div className="mt-3 border-t border-[#EEF1F5] pt-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <Eyebrow>Management state</Eyebrow>
                <span className="text-[11px] text-[#64748B]">{nfmt(managed)} confirmed</span>
              </div>
              <StackBar parts={parts} label="Management state" />
              <div className="mt-2.5"><PartLegend parts={parts} total={d.total} /></div>
            </div>
          </div>
        );
      })}
    </Box>
  );
}

/* ---------- 4c) Compliance & regulated data ---------- */
function ComplianceCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="Regulatory scope & data" icon={<ClipboardCheck size={15} />} sub="Assets in a regulatory scope, and the regulated data they carry" busy={busy(q)} className={className}>
      {body(q, 'Compliance', (d) => {
        const c = d.compliance;
        const inScope = c?.in_scope ?? 0;
        const reg = (c?.regulated ?? []).filter((r) => r.n > 0);
        const scopes = c?.scopes ?? [];
        if (!c || (!inScope && !reg.length && !scopes.length)) {
          return <Empty icon={<ClipboardCheck size={16} />} title="No regulatory scope recorded" body="Tag assets as CDE / ePHI, set regulated-data types or a compliance scope to track obligations here." href={REG} cta="Open register" />;
        }
        return (
          <div className="flex flex-1 flex-col">
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              <Fig label="In regulatory scope" value={nfmt(inScope)} sub={share(inScope, d.total) || '0%'} />
              <Fig label="CDE (PCI)" value={nfmt(c.cde ?? 0)} sub="cardholder data" />
              <Fig label="ePHI (HIPAA)" value={nfmt(c.ephi ?? 0)} sub="health data" />
            </div>
            <div className="mt-3 flex flex-1 flex-col border-t border-[#EEF1F5] pt-3">
              <Eyebrow>Regulated data type</Eyebrow>
              {reg.length ? <BarList fill rows={bars(reg)} /> : <p className="m-0 text-[11.5px] text-[#64748B]">No regulated-data type set.</p>}
            </div>
            {scopes.length > 0 && (
              <div className="mt-3 border-t border-[#EEF1F5] pt-3">
                <Eyebrow>Compliance frameworks in scope</Eyebrow>
                <BarList rows={bars(scopes)} />
              </div>
            )}
          </div>
        );
      })}
    </Box>
  );
}

/* ---------- 5a) Telemetry coverage — knowledge completeness by the 3 telemetry domains ---------- */
/* PRIMARY structure = the product's three telemetry domains (Hardware · Software · Security),
   each a labelled band of coverage rows. The estate-wide governance/freshness signals sit below
   as a smaller secondary group. Every number is a regrouping of the same /estate-overview
   completeness dims (+ the software products count the query already carries) — nothing invented. */
type CovDim = { label: string; n: number; of: number; scope?: string; note?: ReactNode };
function CoverageCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="Telemetry coverage" icon={<ShieldCheck size={15} />} sub="How complete our knowledge of the estate is — the signal held for each telemetry domain, and where the blind spots are" busy={busy(q)} className={className}>
      {body(q, 'Coverage', (d) => {
        const dims = d.completeness?.dims ?? [];
        if (!dims.length || !d.total) return <Empty icon={<ShieldCheck size={16} />} title="Coverage appears with assets" body="Once the inventory holds assets, this maps how much telemetry each domain carries." href="/cyber-assurance/asset-discovery" cta="Bring assets in" />;
        const pick = (k: string): CovDim | undefined => { const x = dims.find((r) => r.key === k); return x ? { label: x.label, n: x.n, of: x.of } : undefined; };
        // Host-signal denominator = the internal estate size (what every internal-scoped dim is measured against).
        const intOf = dims.find((r) => r.scope === 'internal')?.of ?? 0;
        const sw = d.software;
        const cap = d.capacity;
        const sec = d.security;
        const secScope = sec?.scope ?? 0;
        const osFam = (d.internal?.os ?? []).filter((o) => o.n > 0);
        // Internal host names behind every domain — the same per-class samples the Internal-estate drill renders.
        const intSamples = (d.internal?.classes ?? []).flatMap((c) => c.samples ?? []);
        const intTotal = d.internal?.total ?? 0;
        // Real telemetry PARAMETERS per domain — the same /estate-overview blocks the Hardware (capacity),
        // Software (software + internal.os) and Endpoint-security (security) cards read, aggregated for the
        // drill pop-up. Every figure is guarded; a missing block renders an honest "not collected yet".
        const hwParams = cap && cap.hosts ? (
          <>
            <Eyebrow>Fleet hardware</Eyebrow>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <Fig label="Hosts profiled" value={nfmt(cap.hosts)} sub={`${share(cap.hosts, intTotal) || '0%'} of internal`} />
              <Fig label="Total compute" value={nfmt(cap.vcpu)} sub="vCPU across fleet" />
              <Fig label="Total memory" value={gb(cap.ram_gb)} sub="RAM across fleet" />
              <Fig label="Total storage" value={gb(cap.disk_gb)} sub="disk across fleet" />
            </div>
          </>
        ) : null;
        const swParams = sw && (sw.products || (sw.top?.length ?? 0) || sw.hosts_reporting) ? (
          <>
            <Eyebrow>Software inventory</Eyebrow>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <Fig label="Products catalogued" value={nfmt(sw.products)} />
              {sw.installs != null && <Fig label="Installs" value={nfmt(sw.installs)} />}
              <Fig label="Hosts reporting" value={nfmt(sw.hosts_reporting)} sub={`${share(sw.hosts_reporting, intTotal) || '0%'} of internal`} />
            </div>
            {(sw.top?.length ?? 0) > 0 && (
              <div className="mt-3">
                <Eyebrow>Top products · version · hosts</Eyebrow>
                <SwGrid rows={sw.top} more={sw.more} unit="host" />
              </div>
            )}
            {osFam.length > 0 && (
              <div className="mt-3 border-t border-[#EEF1F5] pt-3">
                <Eyebrow>Operating system family · hosts</Eyebrow>
                <BarList fill rows={bars(osFam)} />
              </div>
            )}
          </>
        ) : null;
        const secParams = sec && secScope ? (
          <>
            <Eyebrow>Endpoint protection</Eyebrow>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <Fig label="Hosts read" value={share(sec.posture, secScope) || '0%'} sub={`${nfmt(sec.posture)} of ${nfmt(secScope)} internal`} />
              <Fig label="Packages catalogued" value={nfmt(sec.packages)} sub={`on ${plural(sec.inventoried, 'host')}`} />
              {sec.edr_stopped > 0 && <Fig label="EDR stopped" value={nfmt(sec.edr_stopped)} sub="installed, not running" alarm />}
            </div>
            <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-x-7 gap-y-1 p-0 sm:grid-cols-2">
              {[
                { label: 'Antivirus present', n: sec.antivirus, of: secScope },
                { label: 'EDR running', n: sec.edr, of: secScope },
                { label: 'Endpoint protected', n: sec.protected, of: secScope },
                { label: 'CIS benchmarked', n: d.coverage.cis, of: secScope },
              ].map((r) => <CovRow key={r.label} label={r.label} n={r.n} of={r.of} bare />)}
            </ul>
            <div className="mt-3 border-t border-[#EEF1F5] pt-3">
              <Eyebrow>Security-relevant software · hosts running one</Eyebrow>
              {sec.families?.length ? <BarList rows={bars(sec.families)} max={secScope} fill /> : <p className="m-0 text-[11.5px] text-[#64748B]">No security tooling catalogued yet.</p>}
            </div>
          </>
        ) : null;
        const domains: { key: string; label: string; blurb: string; rows: (CovDim | undefined)[]; params: ReactNode }[] = [
          { key: 'hw', label: 'Hardware', blurb: 'CPU · RAM · disk telemetry', rows: [pick('hardware')], params: hwParams },
          { key: 'sw', label: 'Software', blurb: 'OS & installed products', rows: [
            pick('os'),
            sw ? { label: 'Software inventoried', n: sw.hosts_reporting, of: intOf, note: `${nfmt(sw.products)} ${sw.products === 1 ? 'product' : 'products'}` } : undefined,
          ], params: swParams },
          { key: 'sec', label: 'Security', blurb: 'Endpoint posture & hardening', rows: [pick('security'), pick('cis')], params: secParams },
        ];
        const gov = (['classified', 'owner', 'criticality', 'lifecycle', 'environment', 'seen30'] as const)
          .map(pick).filter(Boolean) as CovDim[];
        return (
          <div className="flex flex-1 flex-col">
            {/* The three domains spread to fill the card height; bars simply get more breathing room when tall. */}
            <div className="flex flex-1 flex-col justify-between gap-3.5">
              {domains.map((dm) => <CovDomain key={dm.key} label={dm.label} blurb={dm.blurb} rows={dm.rows} params={dm.params} samples={intSamples} total={intTotal} />)}
            </div>
            {gov.length > 0 && (
              <div className="mt-3 border-t border-[#EEF1F5] pt-2.5">
                <Eyebrow>Governance &amp; freshness</Eyebrow>
                <ul className="m-0 grid list-none grid-cols-2 gap-x-8 p-0 sm:grid-cols-3">
                  {gov.map((r) => <CovRow key={r.label} {...r} bare />)}
                </ul>
              </div>
            )}
            <p className="m-0 mt-2.5 border-t border-[#EEF1F5] pt-2.5 text-[11px] leading-[1.5] text-[#64748B]">
              Share of assets we hold each signal for. The three domains are host-only signals, measured against the <span className="font-medium text-[#475569]">internal</span> estate — an outside-in asset can&rsquo;t carry them, so it isn&rsquo;t counted as a gap. Governance &amp; freshness span the whole estate.
            </p>
          </div>
        );
      }, 8)}
    </Box>
  );
}
/** One telemetry domain: a bold domain header + its coverage rows (full-width when one, 2-up when two).
    The whole band is a drill trigger → a blur pop-up (reused DrillModal) with the domain's coverage
    figures and the internal host NAMES those signals are measured across (the same per-class samples
    the Internal-estate drill renders via AssetList). Per-host signal status isn't fabricated. */
function CovDomain({ label, blurb, rows, params, samples, total }: {
  label: string; blurb: string; rows: (CovDim | undefined)[]; params: ReactNode; samples: Sample[]; total: number;
}) {
  const [open, setOpen] = useState(false);
  const real = rows.filter(Boolean) as CovDim[];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className="group flex w-full cursor-pointer flex-col gap-0.5 rounded-[8px] text-left transition hover:bg-[#F3F7FB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#005B96] sm:flex-row sm:items-start sm:gap-5">
        <div className="shrink-0 pt-[9px] sm:w-[118px]">
          <p className="m-0 flex items-center gap-1 text-[11px] font-bold uppercase tracking-[.08em] text-[#0F172A]">
            {label}<ChevronRight size={12} aria-hidden className="text-[#94A3B8] transition group-hover:translate-x-0.5 group-hover:text-[#64748B]" />
          </p>
          <p className="m-0 mt-0.5 text-[10.5px] leading-[1.3] text-[#94A3B8]">{blurb}</p>
        </div>
        {real.length === 0
          ? <p className="m-0 flex-1 pt-[9px] text-[11.5px] text-[#94A3B8]">Not collected yet.</p>
          : <ul className={`m-0 min-w-0 flex-1 list-none p-0 ${real.length > 1 ? 'grid grid-cols-1 gap-x-8 sm:grid-cols-2' : ''}`}>
              {real.map((r) => <CovRow key={r.label} {...r} bare />)}
            </ul>}
      </button>
      {open && (
        <DrillModal color={T.base} onClose={() => setOpen(false)} title={label} meta={blurb}>
          {/* The real telemetry PARAMETERS for this domain (primary), then a one-line coverage summary
              and the internal host names those signals are measured across. */}
          <ModalSection first title={`${label} telemetry`}>
            {params ?? <p className="m-0 text-[12px] text-[#64748B]">Not collected yet.</p>}
          </ModalSection>
          {real.length > 0 && (
            <ModalSection title="Coverage">
              <ul className="m-0 grid list-none grid-cols-1 gap-x-8 p-0 sm:grid-cols-2">
                {real.map((r) => <CovRow key={r.label} {...r} bare />)}
              </ul>
            </ModalSection>
          )}
          <ModalSection title="Internal hosts measured">
            <p className="m-0 mb-3 text-[12px] leading-[1.5] text-[#64748B]">
              The {label.toLowerCase()} signals are measured across these internal hosts — per-host signal status isn&rsquo;t broken out here.
            </p>
            <AssetList samples={samples} total={total} where="internal" />
          </ModalSection>
        </DrillModal>
      )}
    </>
  );
}
function CovRow({ label, n, of, scope, bare, note }: { label: string; n: number; of: number; scope?: string; bare?: boolean; note?: ReactNode }) {
  const pct = of > 0 ? pctOf(n, of) : 0;
  const low = of > 0 && pct < 50;
  // Two-line row: full label (never truncated) + big % on top, a full-width bar + fraction below.
  // Far more legible than the old squeezed one-liner whose labels clipped to "Owner assig…".
  return (
    <li className={`flex flex-col gap-[5px] py-[9px] ${bare ? '' : 'border-b border-[#F1F4F8] last:border-0'}`}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[12.5px] font-medium text-[#334155]" title={`${label}: ${nfmt(n)} of ${nfmt(of)}`}>
          {label}{scope === 'internal' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[.04em] text-[#64748B]">internal</span>}
          {note && <span className="ml-1.5 text-[10.5px] font-normal text-[#94A3B8]">· {note}</span>}
        </span>
        <b className="shrink-0 text-[14px] font-semibold tabular-nums" style={{ color: of ? (low ? SEV.medium.ink : '#0F172A') : '#94A3B8' }}>{of ? `${pct}%` : '—'}</b>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="h-[7px] min-w-[40px] flex-1 overflow-hidden rounded-full bg-[#EEF1F5]">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, minWidth: n > 0 ? 3 : 0, background: low ? SEV.medium.c : T.base }} />
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-[#64748B]">{nfmt(n)} / {nfmt(of)}</span>
      </div>
    </li>
  );
}

/* ---------- 6a) Obsolescence & freshness ---------- */
function ObsolescenceCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="Obsolescence & freshness" icon={<CalendarClock size={15} />} sub="End-of-life exposure and how recently each asset was last seen" busy={busy(q)} className={className}>
      {body(q, 'Obsolescence', (d) => {
        const eol = d.eol ?? { past: 0, soon: 0, known: 0 };
        const fresh = d.freshness;
        return (
          <div className="flex flex-1 flex-col">
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              <Fig label="Past end-of-life" value={nfmt(eol.past)} sub="no vendor support" alarm={eol.past > 0} />
              <Fig label="Due ≤90 days" value={nfmt(eol.soon)} sub="plan replacement" alarm={eol.soon > 0} />
              <Fig label="EOL dated" value={nfmt(eol.known)} sub={`of ${nfmt(d.internal.total)} internal`} />
            </div>
            <div className="mt-3 flex flex-1 flex-col border-t border-[#EEF1F5] pt-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <Eyebrow>Last seen</Eyebrow>
                {fresh && <span className="text-[11px] text-[#64748B]">{nfmt(fresh.stale)} stale (30d+)</span>}
              </div>
              {fresh?.buckets && fresh.buckets.some((b) => b.n > 0)
                ? <BarList fill rows={fresh.buckets.map((b) => ({ key: b.label, label: b.label, n: b.n, c: b.gap ? '#E0A45E' : T.base, title: b.label }))} />
                : <p className="m-0 text-[11.5px] text-[#64748B]">No last-seen timestamps yet.</p>}
            </div>
          </div>
        );
      })}
    </Box>
  );
}

/* ---------- 4) Needs attention (SME droplet card, restored verbatim) ---------- */
function AttentionCard({ estate, inv, className }: { estate: Q<Estate>; inv: Q<InvOverview>; className: string }) {
  const d = estate.data;
  const aq = inv.data?.attention_queue;
  const rows = d ? [
    { label: 'Assets without an owner', n: d.total - d.coverage.owner, href: `${REG}&view=unowned` },
    { label: 'External names never probed', n: d.external.total - d.external.facets.probed, href: '/cyber-assurance/asset-discovery' },
    { label: 'Not formally assessed', n: aq ? Math.min(aq.assets_unassessed, d.total) : null, href: REG },
    { label: 'Open critical & high vulnerabilities', n: aq ? aq.open_critical_high_vulns : null, href: '/cyber-assurance/vulnerabilities' },
    { label: 'TLS certificates expired or ≤30 days', n: d.external.facets.tls_expired + d.external.facets.tls_expiring_30d, href: `${REG}&view=external` },
    { label: 'Past vendor end-of-life', n: d.eol.past, href: `${REG}&view=internal` },
    { label: 'Not seen in 30+ days', n: d.total - d.coverage.seen_30d, href: `${REG}&view=stale` },
    { label: 'Unidentified assets', n: d.unidentified, href: REG },
  ].sort((a, b) => (b.n ?? -1) - (a.n ?? -1)) : [];
  let attnBody: ReactNode;
  if (estate.isLoading) attnBody = <Loading rows={8} />;
  else if (!d) attnBody = <Unavailable what="Attention list" />;
  else if (!d.total) attnBody = <Empty icon={<ShieldCheck size={16} />} title="Nothing to action yet" body="Gaps appear once the inventory has assets." />;
  else attnBody = (
    <ul className="m-0 flex flex-1 list-none flex-col p-0">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-1 border-b border-[#F1F3F7] last:border-0">
          <Go href={r.href} className="group flex min-h-[30px] flex-1 items-center gap-3 text-[12.5px] hover:text-[#005B96]">
            <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: r.n ? SEV.high.c : GREY }} />
            <span className={`min-w-0 flex-1 truncate ${r.n ? 'text-[#334155]' : 'text-[#94A3B8]'}`}>{r.label}</span>
            <b className="w-[48px] shrink-0 text-right text-[14px] font-semibold tabular-nums" style={{ color: r.n ? T.text : GREY }} title={r.n == null ? 'Source unavailable' : undefined}>{nfmt(r.n)}</b>
            <ChevronRight size={14} aria-hidden className="shrink-0 text-[#CBD5E1] transition group-hover:translate-x-0.5 group-hover:text-[#64748B]" />
          </Go>
        </li>
      ))}
    </ul>
  );
  return <Box title="Needs attention" sub="Largest gaps first — each opens the matching list" busy={busy(estate)} className={className}>{attnBody}</Box>;
}

/* ---------- 7) Estate scale — fleet hardware capacity recorded ---------- */
const gb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} TB` : `${nfmt(n)} GB`);
function ScaleCard({ q, className }: { q: Q<Estate>; className: string }) {
  return (
    <Box title="Estate scale" icon={<Cpu size={15} />} sub="Fleet hardware and value recorded on the register — honest sums over the assets that carry each figure" busy={busy(q)} className={className}>
      {body(q, 'Estate scale', (d) => {
        const c = d.capacity;
        if (!c || !c.hosts) return <Empty compact icon={<Cpu size={16} />} title="No hardware telemetry collected yet" body="CPU, memory and disk appear once hosts are profiled by a credentialed scan or agent." href="/cyber-assurance/asset-discovery" cta="Open Discovery" />;
        const cells = [
          { label: 'Assets in inventory', value: nfmt(d.total), sub: `${nfmt(d.external.total)} external · ${nfmt(d.internal.total)} internal` },
          { label: 'Hosts hardware-profiled', value: nfmt(c.hosts), sub: share(c.hosts, d.total) || '0%' },
          { label: 'Total compute', value: nfmt(c.vcpu), sub: 'vCPU across the fleet' },
          { label: 'Total memory', value: gb(c.ram_gb), sub: 'RAM across the fleet' },
          { label: 'Total storage', value: gb(c.disk_gb), sub: 'disk across the fleet' },
          { label: 'Value recorded', value: c.valuation_n ? nfmt(Math.round(c.valuation_sum)) : '—', sub: c.valuation_n ? `on ${plural(c.valuation_n, 'asset')}` : 'not recorded' },
        ];
        return (
          // Stat tiles that fill the grid evenly — no more figures floated in the middle of a void.
          <div className="grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" style={{ gridAutoRows: '1fr' }}>
            {cells.map((x) => (
              <div key={x.label} className="flex min-w-0 flex-col justify-center rounded-[10px] border border-[#E9EDF3] bg-[#FBFCFE] px-3 py-2.5">
                <p className="m-0 truncate text-[11px] font-medium text-[#475569]" title={x.label}>{x.label}</p>
                <p className="m-0 mt-1 text-[18px] font-semibold leading-[1.1] text-[#0F172A]">{x.value}</p>
                <p className="m-0 mt-0.5 truncate text-[11px] text-[#64748B]" title={x.sub}>{x.sub}</p>
              </div>
            ))}
          </div>
        );
      }, 3)}
    </Box>
  );
}
