'use client';

/**
 * CIS Benchmark — executive compliance dashboard.
 *
 * The second of the two CIS pages in the IT-asset area (the first is the
 * CisHierarchy rule browser). That page browses the rule *library*; this one
 * answers, for a CISO at a glance:
 *     1. How hardened is the estate against its CIS benchmarks, right now?
 *     2. Can I trust that number — how much of the estate is actually scanned?
 *     3. Where does the weakness concentrate (OS families, benchmarks)?
 *     4. What do we fix first (most-failed controls, worst assets)?
 *
 * Layout mirrors that C-level order, top to bottom:
 *     [posture · coverage · estate-by-hardening]   ← answer + trust
 *     [pass rate by OS family · by benchmark]       ← where it concentrates
 *     [remediation priorities · worst assets]       ← what to do next
 *
 * Visual language follows the Performance exec dashboard (dashboard/_components):
 * white cards on a light canvas, brand accent #005B96, a compliance pass-rate ring,
 * 100% stacked bars, honest per-card empty states. Charts are inline SVG/CSS
 * (recharts is mocked in this repo). The card / bar / legend / figure / pill /
 * empty-state primitives and the T / SEV tokens are imported read-only from that
 * dashboard's kit so the two surfaces stay pixel-consistent. We render lists as
 * div rows (not <table>) because this panel lives under the warm `.asset-suite`
 * theme, whose `table` rules carry `!important` and would recolour a table here.
 *
 * Every figure is read live; nothing is fabricated, sampled or trended (no CIS
 * time-series exists, so the page states posture confidently but claims no
 * direction). Data sources:
 *   GET /compliance-plugins/assets-overview       (compliancePluginsApi.assetsOverview)
 *       → per-asset passed/failed/errored, OS family, matched benchmark, last scan.
 *   GET /compliance-plugins/per-asset-coverage?asset_id=N  (perAssetCoverage), fanned
 *       out over the assets with >=1 failing check → rule-level failures with severity.
 * A panel with no backing data shows an empty state, never a zero dressed up as a score.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useQueries } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, ServerCog, ShieldCheck } from 'lucide-react';
import { compliancePluginsApi } from '@/cyber-assurance/lib/api';
import {
  T, SEV, SEV_ORDER, type Sev, type Tone, FONT,
  Card, Empty, Loading, Unavailable, Figure, Pill, Eyebrow,
  nfmt, pctOf, plural,
} from '../../dashboard/_components/kit';
import { StackBar, PartLegend, BarList, type Part, type BarRow } from '../../dashboard/_components/charts';

/* ---------- API shapes (only the fields this page reads) ---------- */
type AssetRow = {
  id: number; name: string; host_name?: string | null; ip_address?: string | null;
  os_family?: string | null; matched_benchmark?: string | null; last_scan_at?: string | null;
  scanned_rules?: number; passed?: number; failed?: number; errored?: number; criticality?: string | null;
};
type Group = { os_family: string; label: string; count: number; assets: AssetRow[] };
type Overview = {
  groups?: Group[];
  totals?: { assets: number; scanned: number; unscanned: number; avg_pass_rate: number; total_rules: number };
};
type CoverageRule = { plugin_id: number; rule_id: string; title: string; severity: string | null; benchmark: string; status: string };
type Coverage = { rules?: CoverageRule[] };
type FlatAsset = AssetRow & { _groupLabel: string; _family: string };

/* ---------- small helpers ---------- */
/** Canonical CIS pass rate = passed / (passed + failed); errors/skips excluded
 *  (same definition the scanner, residual and full-posture views agree on). */
const rate = (passed: number, failed: number): number | null =>
  passed + failed > 0 ? Math.round((passed / (passed + failed)) * 100) : null;
const rateHex = (r: number | null): string =>
  r == null ? T.faint : r >= 85 ? T.success : r >= 55 ? SEV.medium.c : SEV.critical.c;
function rateTone(r: number | null): Tone {
  if (r == null) return { ...SEV.info, label: 'N/S' };
  if (r >= 85) return { label: `${r}%`, c: T.success, ink: T.success, bg: '#E7F5EE' };
  if (r >= 55) return { ...SEV.medium, label: `${r}%` };
  return { ...SEV.critical, label: `${r}%` };
}
/** Confident one-word hardening band for a pass rate (same 85 / 55 cut-offs as the colours). */
function bandTone(r: number | null): Tone {
  if (r == null) return { ...SEV.info, label: 'Unmeasured' };
  if (r >= 85) return { label: 'Strong', c: T.success, ink: T.success, bg: '#E7F5EE' };
  if (r >= 55) return { ...SEV.medium, label: 'Moderate' };
  return { ...SEV.critical, label: 'Weak' };
}
const normSev = (s?: string | null): Sev => {
  const k = (s || '').toLowerCase();
  return (SEV_ORDER as string[]).includes(k) ? (k as Sev) : 'info';
};
const toMs = (iso?: string | null): number => {
  if (!iso) return 0;
  const t = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  return Number.isNaN(t) ? 0 : t;
};
/** CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1 → "Microsoft Windows 11 Enterprise v5.0.1" */
function prettyBenchmark(raw?: string | null): string {
  if (!raw) return '—';
  const s = raw.replace(/^CIS_/, '').replace(/_Benchmark_/, ' ').replace(/_/g, ' ').trim();
  return s.length > 46 ? s.slice(0, 46) + '…' : s;
}

/* ---------- pass-rate ring (compliance reads green-high, so it is its own mark —
   the kit Gauge is a risk gauge whose zones are green-low/red-high) ---------- */
function Ring({ pct, size = 86 }: { pct: number | null; size?: number }) {
  const C = 2 * Math.PI * 52;
  const off = pct == null ? C : C * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div style={{ width: size, height: size, position: 'relative', flex: 'none' }}>
      <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}
        role="img" aria-label={pct == null ? 'Not scanned yet' : `Overall CIS pass rate ${pct}%`}>
        <circle cx="60" cy="60" r="52" fill="none" stroke={T.track} strokeWidth="12" />
        {pct != null && (
          <circle cx="60" cy="60" r="52" fill="none" stroke={rateHex(pct)} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.3,.8,.3,1)' }} />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', lineHeight: 1 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: Math.round(size * 0.27), fontWeight: 700, color: pct == null ? T.faint : T.text }}>{pct == null ? 'N/S' : `${pct}%`}</div>
          <div style={{ fontSize: 10.5, color: T.muted, marginTop: 2 }}>{pct == null ? 'not scanned' : 'checks passing'}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- remediation: most-failed controls (biggest-win fixes first) ---------- */
type FailRule = { rule_id: string; title: string; severity: Sev; benchmark: string; assets: number };

function TopFailList({ rows }: { rows: FailRule[] }) {
  const max = Math.max(1, ...rows.map((r) => r.assets));
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {rows.map((r, i) => (
        <li key={`${r.rule_id}·${r.benchmark}·${i}`}
          className="flex items-center gap-3 border-b border-[#F1F3F7] py-[9px] last:border-0">
          <span aria-hidden className="w-[16px] shrink-0 text-right text-[11px] font-semibold tabular-nums text-[#94A3B8]">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 font-mono text-[10.5px] text-[#64748B]" style={{ fontFamily: 'ui-monospace,Consolas,monospace' }}>{r.rule_id}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#0F172A]" title={r.title}>{r.title}</span>
            </div>
            <div className="mt-[5px] flex items-center gap-2">
              {/* reach bar: how many assets this one control would fix — the biggest-win signal */}
              <span aria-hidden className="relative block h-[5px] flex-1 overflow-hidden rounded-full bg-[#EEF1F5]">
                <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.assets / max) * 100}%`, minWidth: 4, background: SEV[r.severity].c }} />
              </span>
              <span className="shrink-0 truncate text-[10.5px] text-[#94A3B8]" style={{ maxWidth: 150 }} title={r.benchmark}>{prettyBenchmark(r.benchmark)}</span>
            </div>
          </div>
          <Pill tone={SEV[r.severity]} />
          <span className="w-[58px] shrink-0 text-right leading-[1.1]">
            <b className="text-[13px] font-semibold tabular-nums text-[#0F172A]">{nfmt(r.assets)}</b>
            <span className="block text-[10px] text-[#94A3B8]">{r.assets === 1 ? 'asset' : 'assets'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- worst assets to act on first (each links to its asset, client-nav) ---------- */
function WorstList({ rows }: { rows: { a: FlatAsset; r: number | null }[] }) {
  return (
    <ul className="-mx-1.5 m-0 flex list-none flex-col p-0">
      {rows.map(({ a, r }) => (
        <li key={a.id}>
          <Link href={`/cyber-assurance/assets/${a.id}`}
            className="flex items-center gap-3 rounded-[9px] border-b border-[#F1F3F7] px-1.5 py-[9px] last:border-0 hover:bg-[#F6F7FB]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-[#0F172A]" title={a.name}>{a.name}</span>
              <span className="block truncate text-[10.5px] text-[#94A3B8]">{a._groupLabel || a.os_family || '—'}{a.host_name ? ` · ${a.host_name}` : ''}</span>
            </span>
            <span className="shrink-0 text-right leading-[1.1]">
              <b className="text-[12.5px] font-semibold tabular-nums" style={{ color: (a.failed || 0) > 0 ? SEV.critical.ink : T.muted }}>{nfmt(a.failed || 0)}</b>
              <span className="block text-[10px] text-[#94A3B8]">failing</span>
            </span>
            <span className="w-[52px] shrink-0 text-right"><Pill tone={rateTone(r)} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ---------- dashboard ---------- */
export default function CisDashboard() {
  const overviewQ = useQuery({
    queryKey: ['cis-dash.assets-overview'],
    queryFn: async () => (await compliancePluginsApi.assetsOverview()).data as Overview,
    staleTime: 60_000,
  });

  const groups = overviewQ.data?.groups ?? [];
  const allAssets: FlatAsset[] = useMemo(
    () => groups.flatMap((g) => (g.assets ?? []).map((a) => ({ ...a, _groupLabel: g.label, _family: g.os_family }))),
    [groups],
  );

  // Estate roll-up (checks = rule instances summed across assets).
  const roll = useMemo(() => {
    let passed = 0, failed = 0, errored = 0, scannedAssets = 0, withBenchmark = 0, lastScan = 0;
    let strong = 0, moderate = 0, weak = 0;
    for (const a of allAssets) {
      passed += a.passed || 0; failed += a.failed || 0; errored += a.errored || 0;
      if ((a.scanned_rules || 0) > 0) scannedAssets += 1;
      if (a.matched_benchmark) withBenchmark += 1;
      lastScan = Math.max(lastScan, toMs(a.last_scan_at));
      const r = rate(a.passed || 0, a.failed || 0);
      if (r != null) { if (r >= 85) strong += 1; else if (r >= 55) moderate += 1; else weak += 1; }
    }
    const total = allAssets.length;
    return {
      passed, failed, errored, scannedAssets, withBenchmark, total, lastScan,
      checks: passed + failed + errored,
      awaiting: Math.max(0, withBenchmark - scannedAssets),
      unmapped: Math.max(0, total - withBenchmark),
      passRate: rate(passed, failed),
      strong, moderate, weak, scored: strong + moderate + weak,
    };
  }, [allAssets]);

  // Rule-level failures: per-asset-coverage, fetched ONLY for assets that have a
  // failing check (the only assets that can feed the two rule-level panels).
  // ponytail: one request per failing asset — fine for this product's estate size;
  // if scanned estates grow into the hundreds, add a server-side aggregate endpoint.
  const failingIds = useMemo(() => allAssets.filter((a) => (a.failed || 0) > 0).map((a) => a.id), [allAssets]);
  const coverageQs = useQueries({
    queries: failingIds.map((id) => ({
      queryKey: ['cis-dash.coverage', id],
      queryFn: async (): Promise<Coverage> => (await compliancePluginsApi.perAssetCoverage(id)).data as Coverage,
      staleTime: 60_000,
      retry: 1,
    })),
  });
  // Fold the fan-out into severity + top-failing aggregates. Fingerprint the
  // per-query status/timestamps so this recomputes only when a query settles.
  const covFp = coverageQs.map((q) => `${q.status}:${q.dataUpdatedAt || 0}`).join('|');
  const fail = useMemo(() => {
    const loading = coverageQs.length > 0 && coverageQs.some((q) => q.isLoading);
    const settled = coverageQs.filter((q) => q.data);
    const bySev: Record<string, number> = {};
    const byRule = new Map<number, FailRule>();
    let total = 0;
    for (const q of settled) {
      for (const r of (q.data as Coverage).rules || []) {
        if (r.status !== 'failed') continue;
        total += 1;
        const sv = normSev(r.severity);
        bySev[sv] = (bySev[sv] || 0) + 1;
        const cur = byRule.get(r.plugin_id) || { rule_id: r.rule_id, title: r.title, severity: sv, benchmark: r.benchmark, assets: 0 };
        cur.assets += 1;
        byRule.set(r.plugin_id, cur);
      }
    }
    const top = Array.from(byRule.values()).sort((a, b) => b.assets - a.assets || a.rule_id.localeCompare(b.rule_id)).slice(0, 10);
    const critHigh = (bySev.critical || 0) + (bySev.high || 0);
    return { loading, haveData: settled.length > 0, total, bySev, top, critHigh };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covFp]);

  // Pass rate by OS family (weakest first; unscanned families sort last).
  const familyRows: BarRow[] = useMemo(() => groups.map((g) => {
    let p = 0, f = 0, sc = 0;
    for (const a of g.assets ?? []) { p += a.passed || 0; f += a.failed || 0; if ((a.scanned_rules || 0) > 0) sc += 1; }
    const r = rate(p, f);
    return { key: g.os_family, label: g.label, n: r, c: rateHex(r), value: r == null ? undefined : `${r}%`, title: `${g.label}: ${sc} of ${g.count} scanned · ${nfmt(p)} pass · ${nfmt(f)} fail` };
  }).sort((a, b) => (a.n ?? 101) - (b.n ?? 101)), [groups]);

  // Pass rate by matched benchmark (assets without a benchmark are excluded).
  const benchRows: BarRow[] = useMemo(() => {
    const m = new Map<string, { p: number; f: number; n: number }>();
    for (const a of allAssets) {
      if (!a.matched_benchmark) continue;
      const cur = m.get(a.matched_benchmark) || { p: 0, f: 0, n: 0 };
      cur.p += a.passed || 0; cur.f += a.failed || 0; cur.n += 1;
      m.set(a.matched_benchmark, cur);
    }
    return Array.from(m.entries()).map(([b, v]) => {
      const r = rate(v.p, v.f);
      return { key: b, label: prettyBenchmark(b), n: r, c: rateHex(r), value: r == null ? undefined : `${r}%`, title: `${prettyBenchmark(b)}: ${plural(v.n, 'asset')} · ${nfmt(v.p)} pass · ${nfmt(v.f)} fail` };
    }).sort((a, b) => (a.n ?? 101) - (b.n ?? 101));
  }, [allAssets]);

  // Worst assets (lowest pass rate first) — only assets with evaluated checks.
  const worst = useMemo(() => allAssets
    .map((a) => ({ a, r: rate(a.passed || 0, a.failed || 0) }))
    .filter((x) => x.r != null)
    .sort((x, y) => (x.r as number) - (y.r as number))
    .slice(0, 8), [allAssets]);

  const checkParts: Part[] = [
    { key: 'passed', label: 'Passed', n: roll.passed, c: T.success },
    { key: 'failed', label: 'Failed', n: roll.failed, c: SEV.critical.c },
    { key: 'errored', label: 'Errored', n: roll.errored, c: SEV.info.c },
  ];
  const covParts: Part[] = [
    { key: 'scanned', label: 'Scanned', n: roll.scannedAssets, c: T.base },
    { key: 'awaiting', label: 'Awaiting scan', n: roll.awaiting, c: SEV.medium.c },
    { key: 'unmapped', label: 'No benchmark mapped', n: roll.unmapped, c: '#CBD5E1' },
  ];
  const hardeningParts: Part[] = [
    { key: 'strong', label: 'Strong · ≥85%', n: roll.strong, c: T.success },
    { key: 'moderate', label: 'Moderate · 55–84%', n: roll.moderate, c: SEV.medium.c },
    { key: 'weak', label: 'Weak · <55%', n: roll.weak, c: SEV.critical.c },
  ];
  const sevParts: Part[] = SEV_ORDER.map((s) => ({ key: s, label: SEV[s].label, n: fail.bySev[s] || 0, c: SEV[s].c })).filter((p) => p.n > 0);

  const scanned = roll.scannedAssets > 0;
  const band = bandTone(roll.passRate);
  const unmeasured = roll.awaiting + roll.unmapped;
  const grid = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12';

  return (
    <div className="flex flex-col gap-2.5" style={{ zoom: 0.8, background: '#EDF0F5', padding: '12px 16px', minHeight: 'calc((100vh - 46px) / 0.8)', fontFamily: FONT, color: T.text }}>
      {overviewQ.isLoading ? (
        <Loading rows={6} note="Loading CIS scan results across the estate…" />
      ) : overviewQ.isError ? (
        <Unavailable what="CIS compliance" href="/cyber-assurance/admin/agents" />
      ) : roll.total === 0 ? (
        <Empty icon={<ServerCog size={18} />} title="No assets in inventory yet" body="Discover or import assets, connect a scanner, then run a CIS benchmark scan to see hardening across the estate." href="/cyber-assurance/asset-discovery" cta="Bring assets in" />
      ) : !scanned ? (
        // Mapped-but-unscanned: the coverage breakdown + one honest CTA.
        <>
          <div className={grid}>
            <Card title="Scan coverage" sub="Assets ready vs scanned" className="xl:col-span-5">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', marginBottom: 6 }}>
                <Figure dense label="Matched & ready" value={nfmt(roll.withBenchmark)} sub={`of ${nfmt(roll.total)} assets`} />
                <Figure dense label="No benchmark yet" value={nfmt(roll.unmapped)} sub="need an OS profile" />
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 10 }}><StackBar parts={covParts} label="Scan coverage" /></div>
              <div style={{ marginTop: 10 }}><PartLegend parts={covParts} total={roll.total} /></div>
            </Card>
            <div className="xl:col-span-7">
              <Empty icon={<ClipboardCheck size={18} />} title="No CIS scan has run yet"
                body={<>{nfmt(roll.total)} assets in inventory{roll.withBenchmark ? <>, {nfmt(roll.withBenchmark)} already matched to a benchmark and ready to scan</> : null}. Hardening is <b className="font-semibold">unmeasured</b>, not passing — run a scan to populate this dashboard.</>}
                href="/cyber-assurance/admin/agents" cta="Connect a scanner" />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* ── Answer + trust: posture · coverage honesty · estate by hardening ── */}
          <div className={grid}>
            <Card title="Overall CIS compliance" sub="Passed ÷ (passed + failed)" busy={overviewQ.isFetching} className="xl:col-span-4">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Ring pct={roll.passRate} />
                <div style={{ flex: 1, minWidth: 128 }}>
                  <Pill tone={band}>{band.label} hardening</Pill>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 8 }}>
                    <Figure dense label="Failing checks" value={nfmt(roll.failed)} sub={roll.failed > 0 ? 'need remediation' : 'all passing'} />
                    <Figure dense label="Critical & high"
                      value={fail.haveData ? nfmt(fail.critHigh) : (fail.loading ? '…' : '—')}
                      sub="highest severity" />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 10 }}><StackBar parts={checkParts} label="Checks passed, failed, errored" /></div>
              <div style={{ marginTop: 10 }}><PartLegend parts={checkParts} total={roll.checks} cols={3} /></div>
            </Card>

            <Card title="Scan coverage" sub="You can't claim compliance on unscanned assets" className="xl:col-span-4">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', marginBottom: 6 }}>
                <Figure dense label="Scanned" value={`${nfmt(roll.scannedAssets)} / ${nfmt(roll.total)}`} sub={`${pctOf(roll.scannedAssets, roll.total)}% of the estate`} />
                <Figure dense label="Unmeasured" value={nfmt(unmeasured)} sub="awaiting scan or unmapped" />
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 10 }}><StackBar parts={covParts} label="Scan coverage" /></div>
              <div style={{ marginTop: 10 }}><PartLegend parts={covParts} total={roll.total} /></div>
              {unmeasured > 0 && (
                <p className="m-0 mt-3 flex items-start gap-1.5 rounded-[10px] bg-[#F6F7FB] px-3 py-2 text-[11px] leading-[1.5] text-[#475569]">
                  <AlertTriangle size={13} aria-hidden className="mt-[1px] shrink-0" style={{ color: T.warning }} />
                  <span><b className="font-semibold">{nfmt(unmeasured)}</b> {unmeasured === 1 ? 'asset is' : 'assets are'} unmeasured — not compliant, just unseen.</span>
                </p>
              )}
            </Card>

            <Card title="Estate by hardening" sub="Scanned assets grouped by pass rate" className="md:col-span-2 xl:col-span-4">
              {roll.scored === 0 ? (
                <Empty compact title="No asset scored yet" body="An asset is scored once it has evaluated (passed or failed) checks." />
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', marginBottom: 6 }}>
                    <Figure dense label="Well hardened" value={nfmt(roll.strong)} sub={`${pctOf(roll.strong, roll.scored)}% of ${plural(roll.scored, 'scored asset')}`} />
                    <Figure dense label="Weak (<55%)" value={nfmt(roll.weak)} sub={roll.weak > 0 ? 'act first' : 'none'} />
                  </div>
                  <div style={{ marginTop: 'auto', paddingTop: 10 }}><StackBar parts={hardeningParts} label="Scanned assets by hardening band" /></div>
                  <div style={{ marginTop: 10 }}><PartLegend parts={hardeningParts} total={roll.scored} /></div>
                </>
              )}
            </Card>
          </div>

          {/* ── Where it concentrates: pass rate by OS family · by benchmark ── */}
          <div className={grid}>
            <Card title="Pass rate by OS family" sub="Weakest hardening first" className="xl:col-span-6">
              {familyRows.some((r) => r.n != null)
                ? <BarList rows={familyRows} max={100} labelWidth={150} missing="Not scanned" fill />
                : <Empty compact title="Nothing measured yet" body="Scan an asset in any category to compare families." />}
            </Card>
            <Card title="Pass rate by benchmark" sub="Matched CIS benchmarks" className="xl:col-span-6">
              {benchRows.some((r) => r.n != null)
                ? <BarList rows={benchRows} max={100} labelWidth={210} missing="Not scanned" fill />
                : <Empty compact title="No benchmark measured yet" body="Assets need an OS profile before a CIS benchmark is matched and scanned." />}
            </Card>
          </div>

          {/* ── What to do next: remediation priorities · worst assets ── */}
          <div className={grid}>
            <Card title="Remediation priorities" sub="Fix the controls failing on the most assets" className="xl:col-span-7">
              {fail.loading && !fail.haveData ? <Loading rows={6} note="Reading per-asset rule results…" />
                : fail.total === 0 ? <Empty compact icon={<ShieldCheck size={16} />} title="No failing checks" body="Every evaluated check on every scanned asset passed." />
                  : (
                    <div className="flex flex-1 flex-col">
                      {/* severity split of all failing checks — the shape of the backlog */}
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <Eyebrow>Failing checks by severity</Eyebrow>
                        <span className="text-[11.5px] text-[#64748B]">{plural(fail.total, 'failing check')} · {plural(failingIds.length, 'asset')}</span>
                      </div>
                      <StackBar parts={sevParts} label="Failing checks by severity" />
                      <div className="mt-2.5"><PartLegend parts={sevParts} total={fail.total} cols={3} /></div>
                      <div className="mt-3 border-t border-[#F1F3F7] pt-2">
                        <Eyebrow className="mb-0.5">Fix these first — ranked by assets affected</Eyebrow>
                        <TopFailList rows={fail.top} />
                      </div>
                    </div>
                  )}
            </Card>
            <Card title="Worst assets to act on first" sub="Lowest pass rate · each opens the asset" className="xl:col-span-5">
              {worst.length === 0 ? <Empty compact title="No scored assets yet" body="Pass rates appear once an asset has evaluated checks." />
                : <WorstList rows={worst} />}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
