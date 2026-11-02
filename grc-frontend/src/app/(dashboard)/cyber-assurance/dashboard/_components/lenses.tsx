'use client';

/**
 * Module lenses for the Performance dashboard. Each lens owns its own derivations
 * from ONE module's live payload and its own loading / unavailable / empty state,
 * so a slow or missing module never blanks the rest of the page.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Bot, Building2, ClipboardCheck, Globe, KeyRound, Radar, Target } from 'lucide-react';
import type { LicenseSummary } from '@/cyber-assurance/lib/api';
import { rollupCounts, isExternalAsset as canonIsExternal } from '@/cyber-assurance/lib/domains';
import { AgeMatrix, BarList, PartLegend, StackBar, type BarRow, type Part } from './charts';
import {
  BAND, Card, Empty, Eyebrow, Figure, GRADE, Loading, Pill, SEV, SEV_ORDER, Skel, T, Unavailable,
  alpha, fmtDay, fmtWhen, money, nfmt, pctOf, plural, share, toBand, utc, type Sev, type Tone,
} from './kit';

/* ---------- API shapes (only the fields this page reads) ---------- */
export type Qs<X> = { data?: X | null; isLoading: boolean; isError: boolean; isFetching?: boolean };
/** A card is "busy" while any of its queries refetches over data already shown (Refresh). */
export const busyOf = (...qs: Qs<unknown>[]) => qs.some((q) => !!q.isFetching && !q.isLoading);
export type TopAsset = { asset_id: number; name: string; internet_facing: boolean; open: number } & Record<Sev, number>;
export type ExecSummary = {
  findings: {
    total: number; open: number; resolved: number; by_severity: Record<Sev, number>;
    age_by_severity: Record<Sev, Record<string, number>>; internet_exposed: number; kev: number;
    public_exploit: number; with_cve: number; high_epss: number; intel_checked: number;
    by_source: { source: string; open: number }[];
  };
  top_assets: TopAsset[];
  pentest: {
    findings: { total: number; open: number; by_severity: Record<Sev, number> };
    targets: number; last_finding_at: string | null;
    exploits: null | { runs: number; findings_tested: number; confirmed: number; access_proven: number; by_status: Record<string, number>; last_run_at: string | null };
  };
};
export type RiskAsset = {
  id: number; name: string; host_name?: string | null; asset_type?: string | null; mode?: string | null;
  // Classification signals (from the risk payload) so isExternalAsset reads the real rule.
  internet_facing?: boolean | null; is_internet_facing?: boolean | null; origin_source?: string | null; last_seen_source?: string | null;
  is_external?: boolean | null; owner_id?: number | null; cde_environment?: boolean | null;
  score: number | null; band: { label: string; description?: string }; known_dimensions?: string[]; contributions?: Record<string, number>;
};
export type RiskDash = {
  assets: RiskAsset[];
  summary: { asset_count: number; scored_count: number; avg_score: number | null; by_band: Record<string, number>; highest_score: number | null; highest_name?: string | null };
  weights?: Record<string, number>;
};
export type Inventory = {
  no_data?: boolean;
  counts?: { assets: number; vulnerabilities: number; open_vulnerabilities: number };
  performance?: { score: number | null; grade: string | null; components: { key: string; label: string; score: number | null; weight: number; target: number }[] };
  attention_queue?: { assets_without_owner: number; assets_unassessed: number; open_critical_high_vulns: number; stale_assets: number; internet_facing_unassessed: number };
};
export type AssetsDash = { total_assets: number; by_type?: Record<string, number> };
export type CisOverview = {
  groups?: { label: string; count: number; assets: { has_connection?: boolean; matched_benchmark?: string | null; last_scan_at?: string | null }[] }[];
  totals?: { assets: number; scanned: number; unscanned: number; avg_pass_rate: number; total_rules: number };
};
export type Easm = {
  summary?: { graded: number; ungraded: number; total: number; avg_score: number | null; avg_grade: string | null; grade_counts: Record<string, number> };
  assets?: { asset_id: number; name: string; grade: string; score: number; tls_expired?: boolean; weak?: string[] }[];
};
export type Devices = {
  devices?: { in_inventory?: boolean; connectable?: boolean; discovery_sources?: string[] }[];
  runs?: { run_id: number; finished_at: string | null; is_latest?: boolean }[];
};
export type Ctem = { scopes?: { id: number; name: string; assets: number; findings: number; dangerous: number; cycleOpen: boolean; cycleNo: number; cycleDay: number | null }[] };

export const AGES = ['0-7 days', '8-30 days', '31-90 days', '90+ days'];
// Single source of truth — delegates to @/lib/domains (internet-facing / EASM /
// outside-in). Re-exported here so existing importers (dashboard page) are unchanged.
export const isExternalAsset = (a: RiskAsset) => canonIsExternal(a);
const sevParts = (by: Record<Sev, number>, keepZero = true): Part[] =>
  SEV_ORDER.map((s) => ({ key: s, label: SEV[s].label, n: by?.[s] ?? 0, c: SEV[s].c })).filter((p) => keepZero || p.n > 0);

/* A label · value · share row list — for counts that are not parts of one whole.
   One line per row at any width (label truncates, full text in the tooltip); numbers
   right-aligned in fixed tabular columns. `fill` spreads the rows over the card height. */
function StatRows({ rows, fill }: { rows: { label: ReactNode; tip?: string; n: number; of?: number; c?: string }[]; fill?: boolean }) {
  return (
    <ul className={`m-0 flex list-none flex-col p-0 ${fill ? 'flex-1 justify-between' : ''}`}>
      {rows.map((r, i) => (
        <li key={i} className="flex items-baseline gap-1.5 border-b border-[#F1F3F7] py-[6px] text-[12px] last:border-0" title={r.tip ?? (typeof r.label === 'string' ? r.label : undefined)}>
          <span className="min-w-0 flex-1 truncate text-[#334155]">{r.label}</span>
          {/* c = optional emphasis colour, applied only while the count is non-zero */}
          <b className="min-w-[28px] shrink-0 text-right font-semibold tabular-nums text-[#0F172A]" style={r.c && r.n ? { color: r.c } : undefined}>{nfmt(r.n)}</b>
          <span className="w-[30px] shrink-0 text-right text-[11px] tabular-nums text-[#94A3B8]">{r.of ? share(r.n, r.of) : ''}</span>
        </li>
      ))}
    </ul>
  );
}

/* =============== Vulnerabilities =============== */
// C-level view groups findings by ASSESSMENT TYPE, never by scan engine (tool names stay hidden).
const assessmentOf = (source: string): string => {
  const s = source.toLowerCase();
  if (s.includes('pentestgpt')) return 'Penetration test';
  if (s.includes('zap')) return 'Web application scan';
  return 'Vulnerability scan'; // openvas / nessus / hexstrike / nuclei / scanner …
};

/* Four one-idea tiles (severity · exploitability · age · assessment type) in their own
   equal-height row. The age matrix gets 1.3× width so its six columns always fit; the
   four tiles share one register link, so each carries an arrow-only CTA (keeps every
   title on one line at ≥1366px). */
export function VulnExposure({ q }: { q: Qs<ExecSummary> }) {
  const f = q.data?.findings;
  const busy = busyOf(q);
  const one = (body: ReactNode) => <Card title="Vulnerability exposure" href="/cyber-assurance/vulnerabilities" cta="Register" busy={busy} className="md:col-span-2 xl:col-span-12">{body}</Card>;
  if (q.isLoading) return one(<Loading rows={5} />);
  if (!f) return one(<Unavailable what="Finding metrics" href="/cyber-assurance/vulnerabilities" />);
  if (f.open === 0) return one(<Empty icon={<Globe size={16} />} title="No open findings" body={f.total ? `All ${nfmt(f.total)} findings are resolved or accepted.` : 'Nothing scanned or imported yet.'} href="/cyber-assurance/scan-flows" cta="Run a scan" />);
  const parts = sevParts(f.by_severity);
  const intel = f.intel_checked > 0;
  const byAssessment: Record<string, number> = {};
  for (const s of f.by_source) { const k = assessmentOf(s.source); byAssessment[k] = (byAssessment[k] ?? 0) + s.open; }
  const sources: BarRow[] = Object.entries(byAssessment).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ key: label, label, n }));
  const tile = { href: '/cyber-assurance/vulnerabilities', cta: 'Open vulnerability register', ctaIcon: true, busy };
  return (
    <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2 xl:col-span-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title="Findings by severity" sub={plural(f.open, 'open finding')} {...tile}>
        <StackBar parts={parts} label="Open findings by severity" />
        <div className="mt-3 flex flex-1 flex-col"><PartLegend parts={parts} total={f.open} fill /></div>
      </Card>
      <Card title="Exploitability signals" sub="Share of open findings" {...tile}>
        <StatRows fill={intel} rows={[
          { label: 'Internet-facing assets', tip: 'Open findings on internet-facing assets', n: f.internet_exposed, of: f.open },
          { label: 'Carry a CVE', n: f.with_cve, of: f.open },
          ...(intel ? [
            { label: <>Public exploit <span className="text-[#94A3B8]">(of {nfmt(f.intel_checked)})</span></>, tip: `Public exploit available (of ${nfmt(f.intel_checked)} checked)`, n: f.public_exploit },
            { label: 'CISA KEV — in the wild', n: f.kev },
            { label: 'EPSS ≥ 10%', n: f.high_epss },
          ] : []),
        ]} />
        {!intel && (
          <div className="mt-auto pt-2">
            <p className="m-0 rounded-[10px] bg-[#F6F7FB] px-3 py-2 text-[11px] leading-[1.5] text-[#475569]">
              {f.with_cve
                ? <>Exploit intel not run yet — KEV / EPSS status is <b className="font-semibold">unknown</b>, not zero.</>
                : <>No open finding carries a CVE.</>}
            </p>
          </div>
        )}
      </Card>
      <Card title="Finding age" sub="Open findings by days since first detected" {...tile}>
        <div className="-mx-1 flex-1"><AgeMatrix data={f.age_by_severity} ages={AGES} /></div>
      </Card>
      <Card title="Findings by assessment" sub="Open findings by scan type" {...tile}>
        <BarList rows={sources} stacked fill />
      </Card>
    </div>
  );
}

/* =============== Most exposed assets (joined with Risk Posture) =============== */
const th: React.CSSProperties = { padding: '6px 8px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: T.muted, background: T.subtle, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 8px', fontSize: 12, color: T.text, borderBottom: '1px solid #F1F3F7', verticalAlign: 'middle' };

export function TopAssets({ q, risk }: { q: Qs<ExecSummary>; risk: Qs<RiskDash> }) {
  const rows = q.data?.top_assets ?? [];
  const byId = new Map((risk.data?.assets ?? []).map((a) => [a.id, a]));
  let body: ReactNode;
  if (q.isLoading) body = <Loading rows={6} />;
  else if (!q.data) body = <Unavailable what="Asset exposure" href="/cyber-assurance/assets" />;
  else if (!rows.length) body = <Empty icon={<Globe size={16} />} title="No open findings are linked to an asset" body="Findings appear here once scans link them to inventory assets." href="/cyber-assurance/assets" cta="Open inventory" />;
  else body = (
    <div className="-mx-[14px] -mb-[6px] flex-1">
      {/* table-fixed + colgroup: numeric columns hold their width, the asset name
          takes the rest and truncates, so the Risk band never gets clipped and the
          card never scrolls horizontally at any desktop width. h-full: rows share any
          extra height when the row is stretched to its taller neighbour. */}
      <table className="h-full w-full table-fixed" style={{ borderCollapse: 'collapse' }}>
        <colgroup>
          <col />
          <col style={{ width: 44 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 124 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" style={{ ...th, textAlign: 'left', paddingLeft: 14 }}>Asset</th>
            <th scope="col" style={{ ...th, textAlign: 'right' }}>Open</th>
            <th scope="col" style={{ ...th, textAlign: 'left' }}>Crit · High</th>
            <th scope="col" style={{ ...th, textAlign: 'left', paddingRight: 14 }}>Risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const r = byId.get(a.asset_id);
            const b = r ? BAND[toBand(r.band?.label, r.score)] : null;
            return (
              <tr key={a.asset_id}>
                <td style={{ ...td, paddingLeft: 14 }}>
                  <Link href={`/cyber-assurance/assets/${a.asset_id}`} className="block truncate font-semibold text-[#0F172A] hover:text-[#005B96]" title={a.name}>{a.name}</Link>
                  {a.internet_facing && <span className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-[#64748B]"><Globe size={11} aria-hidden className="shrink-0" />Internet-facing</span>}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{nfmt(a.open)}</td>
                <td style={td}>
                  <span className="inline-flex items-center gap-2 tabular-nums" aria-label={`${a.critical} critical, ${a.high} high`}>
                    {(['critical', 'high'] as Sev[]).map((s) => (
                      <span key={s} className="inline-flex items-center gap-1" style={{ color: a[s] ? T.text : T.faint, fontWeight: a[s] ? 600 : 400 }}>
                        <i aria-hidden className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: a[s] ? SEV[s].c : '#E2E8F0' }} />{a[s]}
                      </span>
                    ))}
                  </span>
                </td>
                <td style={{ ...td, paddingRight: 14 }}>
                  {risk.isLoading ? <Skel h={16} w={82} /> : b && r ? <Pill tone={b}>{b.label} · {r.score == null ? '—' : r.score.toFixed(0)}</Pill> : <span className="text-[11.5px] text-[#94A3B8]">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <Card title="Most exposed assets" sub="Worst open findings first · risk band" href="/cyber-assurance/assets" cta="Open inventory" busy={busyOf(q)} className="md:col-span-2 xl:col-span-8">
      {body}
    </Card>
  );
}

/* =============== Attack surface (Discovery + EASM) =============== */
// Same external-source signal the discovery page uses, widened to its real source name.
const EXT_SRC = /certificate transparency|shodan|censys|securitytrail|crt\.sh|\bct\b/i;

export function AttackSurface({ devices, easm }: { devices: Qs<Devices>; easm: Qs<Easm> }) {
  const devs = devices.data?.devices ?? [];
  const total = devs.length;
  const inInv = devs.filter((d) => d.in_inventory).length;
  const ready = devs.filter((d) => !d.in_inventory && d.connectable).length;
  const external = devs.filter((d) => (d.discovery_sources || []).some((s) => EXT_SRC.test(String(s)))).length;
  const runs = devices.data?.runs ?? [];
  const last = runs.find((r) => r.is_latest) ?? runs[0];
  const parts: Part[] = [
    { key: 'inv', label: 'In inventory', n: inInv, c: T.base },
    { key: 'ready', label: 'Login answered, not onboarded', n: ready, c: '#7FA7C9' },
    { key: 'rest', label: 'Not yet connected', n: total - inInv - ready, c: '#CBD5E1' },
  ];
  const es = easm.data?.summary;
  const graded = es?.graded ?? 0;
  const ea = easm.data?.assets ?? [];
  const weak = (k: string) => ea.filter((a) => (a.weak || []).includes(k)).length;
  const signals = [
    { n: ea.filter((a) => a.tls_expired).length, t: 'expired TLS certificate' },
    { n: weak('hsts'), t: 'missing HSTS' },
    { n: weak('headers'), t: 'weak security headers' },
  ].filter((s) => s.n > 0);

  return (
    <Card title="Attack surface" sub="Discovered vs managed" href="/cyber-assurance/asset-discovery" cta="Open Discovery" busy={busyOf(devices, easm)} className="xl:col-span-4">
      {devices.isLoading ? <Loading rows={4} /> : !devices.data ? <Unavailable what="Discovery" href="/cyber-assurance/asset-discovery" /> : total === 0 ? (
        <Empty compact icon={<Radar size={16} />} title="Nothing discovered yet" body="Run a network sweep or an external (EASM) scan to map the attack surface." href="/cyber-assurance/asset-discovery" cta="Start discovery" />
      ) : (
        <div className="flex flex-1 flex-col justify-between">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <Figure label="Under management" value={`${pctOf(inInv, total)}%`} sub={`${nfmt(inInv)} of ${nfmt(total)} discovered`} />
            <Figure label="Not yet managed" value={nfmt(total - inInv)} sub={ready ? `${nfmt(ready)} ready to connect` : 'none ready to connect'} />
          </div>
          <div className="mt-3"><StackBar parts={parts} label="Discovered devices and hostnames" /></div>
          <div className="mt-2.5"><PartLegend parts={parts} total={total} /></div>
          <p className="m-0 mt-2 text-[11px] text-[#64748B]">
            {nfmt(total - external)} internal devices · {nfmt(external)} public hostnames{last?.finished_at ? ` · last run ${fmtWhen(utc(last.finished_at))}` : ''}
          </p>
        </div>
      )}
      <div className="mt-3 flex flex-col border-t border-[#F1F3F7] pt-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <Eyebrow>External posture (EASM)</Eyebrow>
          {es && graded > 0 && <span className="text-[11.5px] text-[#64748B]">avg <b className="font-semibold text-[#0F172A]">{es.avg_grade ?? '—'}</b> · {es.avg_score ?? '—'}/100</span>}
        </div>
        {easm.isLoading ? <Loading rows={3} /> : !easm.data ? <Unavailable what="External posture" href="/cyber-assurance/asset-discovery" /> : graded === 0 ? (
          <Empty compact title="No external host graded yet" body={es?.total ? `${nfmt(es.total)} external hosts known — none probed yet.` : 'Add a domain to grade its public hosts.'} href="/cyber-assurance/asset-discovery" cta="Run an external scan" />
        ) : (
          <>
            <BarList labelWidth={26} max={graded} rows={['A', 'B', 'C', 'D', 'F'].map((g) => ({ key: g, label: <b className="font-semibold text-[#0F172A]">{g}</b>, n: es?.grade_counts?.[g] ?? 0, c: GRADE[g].c, title: `Grade ${g}` }))} />
            <p className="m-0 mt-2 text-[11px] text-[#64748B]">{nfmt(graded)} of {nfmt(es?.total ?? graded)} external hosts graded{signals.length ? ' · ' : ''}{signals.map((s) => `${nfmt(s.n)} ${s.t}`).join(' · ')}</p>
          </>
        )}
      </div>
    </Card>
  );
}

/* =============== Inventory =============== */
const GRADE_TONE: Record<string, Tone> = {
  excellent: { ...BAND.contained, label: 'Excellent' }, good: { ...BAND.contained, label: 'Good' },
  fair: { ...SEV.medium, label: 'Fair' }, poor: { ...SEV.critical, label: 'Poor' },
};
const vsTarget = (s: number, target: number) => (s >= target ? T.success : s >= 50 ? SEV.medium.c : SEV.critical.c);

export function InventoryHealth({ inv, assets }: { inv: Qs<Inventory>; assets: Qs<AssetsDash> }) {
  const d = inv.data;
  const p = d?.performance;
  const aq = d?.attention_queue;
  const target = p?.components?.[0]?.target ?? 85;
  const types = Object.entries(assets.data?.by_type ?? {}).sort((a, b) => b[1] - a[1]);
  let body: ReactNode;
  if (inv.isLoading) body = <Loading rows={7} />;
  else if (!d) body = <Unavailable what="Inventory score" href="/cyber-assurance/assets" />;
  else if (d.no_data || p?.score == null) body = <Empty icon={<ClipboardCheck size={16} />} title="No assets yet" body="Adopt discovered devices or import a register to start scoring the inventory." href="/cyber-assurance/asset-discovery" cta="Bring assets in" />;
  else body = (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3">
        <p className="m-0 text-[24px] font-semibold leading-none text-[#0F172A]">{p.score.toFixed(1)}<span className="ml-1 text-[12px] font-medium text-[#94A3B8]">/100</span></p>
        {p.grade && <Pill tone={GRADE_TONE[p.grade] ?? SEV.info}>{GRADE_TONE[p.grade]?.label ?? p.grade}</Pill>}
        <span className="ml-auto text-[11px] text-[#64748B]">target {target}</span>
      </div>
      <div className="mt-3.5 flex flex-1 flex-col">
        <BarList max={100} target={target} labelWidth={150} fill
          rows={(p.components ?? []).map((c) => ({ key: c.key, label: c.label, n: c.score == null ? null : c.score, c: c.score == null ? undefined : vsTarget(c.score, c.target ?? target), value: c.score == null ? undefined : c.score.toFixed(1), title: `${c.label}: weight ${Math.round(c.weight * 100)}%` }))} />
      </div>
      <p className="m-0 mt-2 flex items-center gap-1.5 text-[10.5px] text-[#94A3B8]"><i aria-hidden className="inline-block h-[10px] w-[2px] rounded-[1px] bg-[#0F172A] opacity-50" />target · green ≥ target, red &lt; 50</p>
      {aq && (
        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-[#F1F3F7] pt-3">
          <Figure label="No owner" value={nfmt(aq.assets_without_owner)} sub={`of ${nfmt(d.counts?.assets)}`} />
          <Figure label="Not assessed" value={nfmt(aq.assets_unassessed)} sub="criticality" />
          <Figure label="Stale" value={nfmt(aq.stale_assets)} sub="not seen 30d+" />
        </div>
      )}
      {types.length > 0 && <p className="m-0 mt-2 text-[11px] text-[#64748B]">{types.map(([k, n]) => `${nfmt(n)} ${k}`).join(' · ')}</p>}
    </div>
  );
  return (
    <Card title="Inventory health" sub="Performance score vs target" href="/cyber-assurance/assets" cta="Open inventory" busy={busyOf(inv, assets)} className="xl:col-span-4">
      {body}
    </Card>
  );
}

/* =============== Penetration testing =============== */
export function PenTest({ q }: { q: Qs<ExecSummary> }) {
  const pt = q.data?.pentest;
  const ex = pt?.exploits;
  let body: ReactNode;
  if (q.isLoading) body = <Loading rows={5} />;
  else if (!pt) body = <Unavailable what="Pentest results" href="/cyber-assurance/pentest" />;
  else if (!pt.findings.total && !ex?.runs) body = <Empty icon={<Bot size={16} />} title="No AI pentest yet" body="Penetration-test findings and validated exploits appear here after the first engagement." href="/cyber-assurance/pentest" cta="Start an AI pentest" />;
  else {
    const parts = sevParts(pt.findings.by_severity, false);
    body = (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <Figure label="Penetration-test findings" value={nfmt(pt.findings.open)} sub={`open of ${nfmt(pt.findings.total)} raised`} />
          <Figure label="Targets tested" value={nfmt(pt.targets)} sub={pt.last_finding_at ? `last finding ${fmtDay(utc(pt.last_finding_at))}` : undefined} />
        </div>
        {pt.findings.open > 0 && (
          <>
            <div className="mt-3"><StackBar parts={parts} label="Open penetration-test findings by severity" /></div>
            <div className="mt-2.5"><PartLegend parts={parts} total={pt.findings.open} cols={2} /></div>
          </>
        )}
        {/* flex-1: this section takes any height the row adds, so its empty state fills
            the card instead of leaving a white bottom */}
        <div className="mt-3 flex flex-1 flex-col border-t border-[#F1F3F7] pt-3">
          <Eyebrow className="mb-2">Exploit validation</Eyebrow>
          {ex == null ? (
            <p className="m-0 text-[11.5px] text-[#64748B]">Exploit results aren&rsquo;t provisioned on this tenant yet.</p>
          ) : ex.runs === 0 ? (
            <Empty compact title="No exploit runs yet" body="Nothing has been proven exploitable or ruled out — approved exploit runs from AI Pentest record their proof here." href="/cyber-assurance/pentest" cta="Open AI Pentest" />
          ) : (
            <div className="my-auto grid grid-cols-3 gap-3">
              <Figure label="Findings tested" value={nfmt(ex.findings_tested)} sub={`${plural(ex.runs, 'run')}`} />
              <Figure label="Confirmed" value={<span style={{ color: ex.confirmed ? SEV.critical.ink : T.text }}>{nfmt(ex.confirmed)}</span>} sub="exploitable" />
              <Figure label="Access proven" value={nfmt(ex.access_proven)} sub={ex.last_run_at ? `last ${fmtDay(utc(ex.last_run_at))}` : undefined} />
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <Card title="Penetration testing" sub="AI findings · exploit validation" href="/cyber-assurance/pentest" cta="Open AI Pentest" busy={busyOf(q)} className="xl:col-span-4">
      {body}
    </Card>
  );
}

/* =============== Risk drivers =============== */
const DIM: Record<string, string> = {
  vuln: 'Vulnerabilities', cis: 'CIS hardening gap', cia: 'Business-impact value', ctrl: 'Control gap', risk: 'Linked risks',
  hygiene: 'Exposure hygiene', exploitability: 'Exploitability', exposure: 'Internet exposure', business: 'Business impact', subdomains: 'Subdomain exposure',
};
const titleCase = (s: string) => s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// Two groups, two accents from the product palette: brand blue (outside-in) · slate (internal).
const GROUP = {
  ext: { Icon: Globe, c: T.base, ink: T.strong, bg: alpha(T.base, 0.07) },
  int: { Icon: Building2, c: '#475569', ink: '#1E293B', bg: '#F1F5F9' },
};

function drivers(list: RiskAsset[], dims: string[]): BarRow[] {
  return dims.map((k) => {
    const known = list.filter((a) => (a.known_dimensions ?? []).includes(k));
    const avg = known.length ? known.reduce((s, a) => s + (a.contributions?.[k] ?? 0), 0) / known.length : null;
    return { key: k, label: DIM[k] ?? titleCase(k), n: avg, value: avg == null ? undefined : avg.toFixed(1), title: `${known.length} of ${list.length} assets measured` };
  }).sort((a, b) => (b.n ?? -1) - (a.n ?? -1));
}

export function RiskDrivers({ risk }: { risk: Qs<RiskDash> }) {
  const d = risk.data;
  let body: ReactNode;
  if (risk.isLoading) body = <Loading rows={6} note="Scoring every asset live — this takes a few seconds." />;
  else if (!d) body = <Unavailable what="Risk posture" href="/cyber-assurance/risk-posture" />;
  else if (!d.summary?.scored_count) body = <Empty icon={<Target size={16} />} title="No asset scored yet" body="Scores appear once assets carry scan, hardening or business-impact data." href="/cyber-assurance/risk-posture" cta="Open Risk Posture" />;
  else {
    const ext = d.assets.filter(isExternalAsset);
    const int = d.assets.filter((a) => !isExternalAsset(a));
    // Count badges use the canonical roll-up (one apex domain = one external
    // asset) so they reconcile with the register + the risk gauge; the driver
    // bars still read per measured asset (they are averages, not counts).
    const roll = rollupCounts(d.assets, isExternalAsset);
    const extDims = Array.from(new Set(ext.flatMap((a) => a.known_dimensions ?? [])));
    const intDims = Object.keys(d.weights ?? {}).length ? Object.keys(d.weights ?? {}) : Array.from(new Set(int.flatMap((a) => a.known_dimensions ?? [])));
    const weights = Object.entries(d.weights ?? {}).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${DIM[k] ?? k} ${Math.round(w * 100)}%`).join(' · ');
    const groups = [
      { key: 'ext' as const, label: 'External assets', count: roll.external, rows: drivers(ext, extDims), note: 'outside-in model', tip: 'Fixed outside-in scoring model for internet-facing assets' },
      { key: 'int' as const, label: 'Internal assets', count: roll.internal, rows: drivers(int, intDims), note: 'tunable weights', tip: weights ? `Tunable weights: ${weights}` : undefined },
    ].filter((g) => g.rows.length && (g.key === 'ext' ? ext.length : int.length));
    const max = Math.max(1, ...groups.flatMap((g) => g.rows.map((r) => r.n ?? 0)));
    body = (
      <div className="flex flex-1 flex-col gap-3">
        {groups.map((g) => {
          const s = GROUP[g.key];
          return (
            <div key={g.key} className="flex flex-1 flex-col">
              {/* Group header = a different class of element from the driver rows: tinted
                  band + accent rule + icon + count badge, in the group's own accent. */}
              <div className="flex items-center gap-2 rounded-[8px] py-[6px] pl-3 pr-2.5" style={{ background: s.bg, boxShadow: `inset 3px 0 0 ${s.c}` }}>
                <s.Icon size={14} aria-hidden className="shrink-0" style={{ color: s.c }} />
                <h3 className="m-0 whitespace-nowrap font-semibold !text-[12px] !leading-[1.3]" style={{ color: s.ink }}>{g.label}</h3>
                <span className="shrink-0 rounded-full bg-white px-[7px] text-[10.5px] font-semibold leading-[18px] tabular-nums" style={{ color: s.c }} title={plural(g.count, 'asset')}>{nfmt(g.count)}</span>
                <span className="ml-auto min-w-0 truncate text-[10.5px] text-[#64748B]" title={g.tip}>{g.note}</span>
              </div>
              {/* top drivers only (already sorted desc) — exec view drops the near-zero / not-measured tail */}
              <div className="flex flex-1 flex-col pl-3 pt-2.5">
                <BarList rows={g.rows.filter((r) => (r.n ?? 0) > 0).slice(0, 4)} max={max} labelWidth={140} color={s.c} fill />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <Card title="What drives the risk score" sub="Avg points per dimension" href="/cyber-assurance/risk-posture" cta="Open Risk Posture" busy={busyOf(risk)} className="xl:col-span-4">
      {body}
    </Card>
  );
}

/* =============== CIS compliance =============== */
export function CisCompliance({ q }: { q: Qs<CisOverview> }) {
  const t = q.data?.totals;
  const ready = (q.data?.groups ?? []).flatMap((g) => g.assets ?? []).filter((a) => a.matched_benchmark && a.has_connection && !a.last_scan_at).length;
  let body: ReactNode;
  if (q.isLoading) body = <Loading rows={4} />;
  else if (!t) body = <Unavailable what="CIS benchmark coverage" href="/cyber-assurance/assets?tab=cis" />;
  else if (!t.scanned) body = (
    <Empty icon={<ClipboardCheck size={16} />} title="No CIS scan yet"
      body={<>0 of {nfmt(t.assets)} assets checked against {nfmt(t.total_rules)} benchmark rules — hardening is <b className="font-semibold">unmeasured</b>, not passing.{ready ? ` ${plural(ready, 'asset')} ${ready === 1 ? 'is' : 'are'} ready now (benchmark matched, connection saved).` : ''}</>}
      href="/cyber-assurance/assets?tab=cis" cta="Run a CIS scan" />
  );
  else {
    const parts: Part[] = [
      { key: 'scanned', label: 'Scanned', n: t.scanned, c: T.base },
      { key: 'unscanned', label: 'Not scanned', n: t.unscanned, c: '#CBD5E1' },
    ];
    body = (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <Figure label="Average pass rate" value={`${Math.round(t.avg_pass_rate)}%`} sub="passed ÷ (passed + failed)" />
          <Figure label="Assets scanned" value={`${nfmt(t.scanned)} / ${nfmt(t.assets)}`} sub={`${nfmt(t.total_rules)} rules in library`} />
        </div>
        <div className="mt-auto pt-3"><StackBar parts={parts} label="CIS scan coverage" /></div>
        <div className="mt-2.5"><PartLegend parts={parts} total={t.assets} /></div>
      </div>
    );
  }
  return (
    <Card title="CIS benchmark compliance" sub="Hardening vs CIS benchmarks" href="/cyber-assurance/assets?tab=cis" cta="Open CIS" busy={busyOf(q)} className="xl:col-span-6">
      {body}
    </Card>
  );
}

/* =============== CTEM =============== */
export function CtemProgramme({ q }: { q: Qs<Ctem> }) {
  const scopes = q.data?.scopes ?? [];
  let body: ReactNode;
  if (q.isLoading) body = <Loading rows={3} />;
  else if (!q.data) body = <Unavailable what="CTEM" href="/cyber-assurance/vulnerabilities/ctem-scopes" />;
  else if (!scopes.length) body = (
    <Empty icon={<Target size={16} />} title="No CTEM scope yet"
      body="Scope a business-critical service to run continuous exposure-management cycles — discover, prioritise, validate, mobilise."
      href="/cyber-assurance/vulnerabilities/ctem-scopes" cta="Create a scope" />
  );
  else body = (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {scopes.slice(0, 4).map((s) => (
        <li key={s.id}>
          <Link href="/cyber-assurance/vulnerabilities/ctem-scopes" className="flex items-center gap-3 rounded-[10px] border border-[#F1F3F7] px-3 py-2.5 hover:border-[#C7D2E4] hover:bg-[#F6F7FB]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-[#0F172A]">{s.name}</span>
              <span className="block text-[11px] text-[#64748B]">{plural(s.assets, 'asset')} · {plural(s.findings, 'finding')} · {nfmt(s.dangerous)} on viable attack paths</span>
            </span>
            <Pill tone={s.cycleOpen ? BAND.contained : SEV.info}>{s.cycleOpen ? `Cycle ${s.cycleNo}${s.cycleDay != null ? ` · day ${s.cycleDay}` : ''}` : 'No open cycle'}</Pill>
          </Link>
        </li>
      ))}
      {scopes.length > 4 && <li className="text-[11px] text-[#64748B]">+{nfmt(scopes.length - 4)} more scopes</li>}
    </ul>
  );
  return (
    <Card title="CTEM programme" sub="Exposure-management scopes & cycles" href="/cyber-assurance/vulnerabilities/ctem-scopes" cta="Open CTEM" busy={busyOf(q)} className="xl:col-span-6">
      {body}
    </Card>
  );
}

/* =============== Software licenses =============== */
// Entitlements the tenant owns (entered by hand or imported — no scan can see a purchase) set against
// the software credentialed scans found installed. One read-only endpoint: /licenses/summary.
// Honest empties: with nothing tracked there is NO compliance % (never a fake 0 or 100), but a non-zero
// unlicensed count is still surfaced — that is the figure an auditor asks for first. "Unlicensed" counts
// INSTALLS (a product on 3 hosts is 3). `under_licensed` is the backend's second name for over_deployed
// (same count), so it is never shown or added a second time. Money arrives in the tenant's primary currency.
export function LicenseCompliance({ q }: { q: Qs<LicenseSummary> }) {
  const s = q.data;
  let body: ReactNode;
  if (q.isLoading) body = <Loading rows={4} />;
  else if (!s) body = <Unavailable what="License compliance" href="/cyber-assurance/licenses" />;
  else if (!s.tracked_products) body = (
    <Empty icon={<KeyRound size={16} />}
      title={s.unlicensed_count ? `${plural(s.unlicensed_count, 'installed copy', 'installed copies')} ${s.unlicensed_count === 1 ? 'has' : 'have'} no license on record` : 'No licenses tracked yet'}
      body="Record the software licenses you own and ComplyVerse compares them with what scans found installed — surfacing unlicensed software, over-deployment and upcoming renewals."
      href="/cyber-assurance/licenses" cta="Add entitlements" />
  );
  else {
    const cur = s.currency || 'USD';
    const exposure = s.exposure_cost ?? 0;
    const unpriced = s.exposure_unpriced ?? 0;
    const unmeasured = s.not_measured_products ?? 0;
    const parts: Part[] = [
      { key: 'ok', label: 'Compliant', n: s.compliant, c: BAND.contained.c },
      { key: 'over', label: 'Over-deployed', n: s.over_deployed, c: SEV.critical.c },
    ];
    const divider = 'xl:border-l xl:border-[#F1F3F7] xl:pl-6';
    const coverage = s.assets_with_inventory != null && s.assets_total != null
      ? `Software inventory collected on ${nfmt(s.assets_with_inventory)} of ${nfmt(s.assets_total)} assets. `
      : '';
    body = (
      <div className="flex flex-1 flex-col">
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <Eyebrow>Compliance</Eyebrow>
            <p className="m-0 mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-[30px] font-semibold leading-none tabular-nums text-[#0F172A]">{s.compliance_pct == null ? '—' : `${Math.round(s.compliance_pct)}%`}</span>
              <span className="text-[11.5px] text-[#64748B]">{nfmt(s.compliant)} of {plural(s.tracked_products, 'product')} compliant</span>
            </p>
            <div className="mt-3"><StackBar parts={parts} label="Tracked products by license status" height={12} /></div>
            <div className="mt-2.5"><PartLegend parts={parts} total={s.tracked_products} /></div>
          </div>

          <div className={`min-w-0 ${divider}`}>
            <Eyebrow className="mb-1">Exposure</Eyebrow>
            <StatRows rows={[
              { label: 'Unlicensed installs', tip: 'Installations with no valid entitlement on record', n: s.unlicensed_count, c: SEV.critical.ink },
              { label: 'Over-deployed products', tip: 'More installed than entitled', n: s.over_deployed, c: SEV.critical.ink },
            ]} />
            <p className="m-0 mt-1.5 text-[11px] leading-[1.45] text-[#64748B]">
              {s.over_deployed === 0
                ? 'No product exceeds its entitlement.'
                : exposure > 0
                  ? <>Shortfall to cover: <b className="font-semibold text-[#0F172A]">{money(exposure, cur, true)}</b>{unpriced ? ` (+${nfmt(unpriced)} unpriced)` : ''}</>
                  : unpriced ? `${nfmt(unpriced)} shortfall${unpriced === 1 ? '' : 's'} can’t be priced — no unit cost recorded.` : ''}
            </p>
          </div>

          <div className={`min-w-0 ${divider}`}>
            <Eyebrow className="mb-1">Expiring licenses</Eyebrow>
            <StatRows rows={[
              ...(s.expired_lines != null ? [{ label: 'Already expired', tip: 'Entitlement lines past their end date', n: s.expired_lines, c: SEV.high.ink }] : []),
              { label: 'Within 30 days', n: s.expiring_30, c: SEV.medium.ink },
              { label: 'Within 60 days', n: s.expiring_60, c: SEV.medium.ink },
              { label: 'Within 90 days', n: s.expiring_90, c: SEV.medium.ink },
            ]} />
            <p className="m-0 mt-1.5 text-[11px] text-[#64748B]">
              Renewal cost, next 90 days: <b className="font-semibold text-[#0F172A]">{s.renewal_cost_90d > 0 ? money(s.renewal_cost_90d, cur, true) : '—'}</b>
            </p>
          </div>

          <div className={`min-w-0 ${divider}`}>
            <Eyebrow className="mb-2">Spend &amp; savings</Eyebrow>
            <div className="grid grid-cols-2 gap-3">
              <Figure label="Annual spend" value={s.annual_spend > 0 ? money(s.annual_spend, cur, true) : '—'} sub={s.annual_spend > 0 ? 'from unit costs recorded' : 'no unit costs recorded'} />
              <Figure label="Reclaimable seats" value={nfmt(s.reclaimable_count)} sub={s.reclaimable_savings > 0 ? `≈ ${money(s.reclaimable_savings, cur, true)} potential savings` : 'surplus or idle seats'} />
            </div>
            <p className="m-0 mt-2 text-[11px] leading-[1.45] text-[#64748B]" title="Reclaimable seats are estimated from surplus entitlements and stale or decommissioned hosts, not from usage metering.">
              Reclaimable is an estimate, not usage metering.
            </p>
          </div>
        </div>
        <p className="m-0 mt-auto pt-3 text-[10.5px] text-[#94A3B8]">
          {coverage}Entitlements are entered by hand, so compliance is only as accurate as those records.
          {unmeasured ? ` ${plural(unmeasured, 'product')} use${unmeasured === 1 ? 's' : ''} a license metric scans can’t count and ${unmeasured === 1 ? 'is' : 'are'} excluded from compliance.` : ''}
        </p>
      </div>
    );
  }
  return (
    <Card title="Software license compliance" sub="Licenses owned vs software found installed" href="/cyber-assurance/licenses" cta="Open Licenses" busy={busyOf(q)} className="md:col-span-2 xl:col-span-12">
      {body}
    </Card>
  );
}
