'use client';

/**
 * PCI compliance lens for the Performance dashboard.
 *
 * Definition (owner's): an asset flagged `cde_environment` (PCI scope) is COMPLIANT when its CIS
 * pass rate is >= 80% AND it has no open Critical/High vulnerability AND no open CISA-KEV
 * vulnerability. Every other in-scope asset is AT RISK. Absence of evidence is not compliance, so
 * an asset with no CIS scan (or whose vulnerabilities couldn't be verified) is never "compliant".
 *
 * Built entirely from EXISTING endpoints, joined client-side (see dashboardExtrasApi.ts):
 *   GET /assets                                        -> cde_environment (the PCI scope flag)
 *   GET /compliance-plugins/assets-overview            -> per-asset CIS pass_rate (shared with the CIS lens)
 *   GET /vuln-management/dashboard/asset-risk-heatmap  -> per-asset open critical/high + KEV counts
 * The join + classification live in dashboardExtrasLogic.ts (unit-tested); this file only draws.
 */
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { CheckCircle2, Landmark } from 'lucide-react';
import { BarList, PartLegend, StackBar, type BarRow, type Part } from './charts';
import { BAND, Card, Eyebrow, Empty, Figure, Loading, SEV, T, Unavailable, nfmt, plural, share } from './kit';
import { LensBoundary } from './LensBoundary';
import { PCI_REASONS, type LensQuery, type PciAssetState, type PciReason, type PciSummary } from '@/cyber-assurance/lib/dashboardExtrasApi';

const PCI_HREF = '/cyber-assurance/assets?tab=inventory&pci=1';
const MAX_ROWS = 5;

const th: CSSProperties = { padding: '6px 8px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: T.muted, background: T.subtle, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '7px 8px', fontSize: 12, color: T.text, borderBottom: '1px solid #F1F3F7', verticalAlign: 'middle' };

const REASON: Record<PciReason, { label: (threshold: number) => string; c: string; tip: string }> = {
  crit_high: { label: () => 'Open critical / high vulnerabilities', c: SEV.critical.c, tip: 'PCI assets with at least one open critical or high vulnerability' },
  kev: { label: () => 'Known-exploited (CISA KEV)', c: SEV.critical.c, tip: 'PCI assets with an open vulnerability on the CISA Known Exploited Vulnerabilities list' },
  cis_low: { label: (t) => `CIS pass rate below ${t}%`, c: SEV.high.c, tip: 'PCI assets scanned against a CIS benchmark but under the pass-rate threshold' },
  cis_unscanned: { label: () => 'No CIS benchmark scan', c: SEV.info.c, tip: 'PCI assets with no CIS scan result — hardening is unmeasured, not passing' },
  vuln_unverified: { label: () => 'Vulnerabilities unverified', c: SEV.info.c, tip: 'Vulnerability data was capped before reaching these assets, so they cannot be shown clean' },
};

const pctLabel = (n: number) => `${Number(n.toFixed(1))}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PciComplianceLens({ q, className = 'xl:col-span-6' }: { q: LensQuery<PciSummary>; className?: string }) {
  return (
    <LensBoundary title="PCI compliance" href={PCI_HREF} className={className}>
      <PciCompliance q={q} className={className} />
    </LensBoundary>
  );
}

function PciCompliance({ q, className }: { q: LensQuery<PciSummary>; className: string }) {
  const s = q.data;
  const busy = !!q.isFetching && !q.isLoading;
  const frame = (body: ReactNode) => (
    <Card title="PCI DSS compliance" sub="Cardholder-data (CDE) assets · CIS and open vulnerabilities"
      href={PCI_HREF} cta="Open PCI assets" busy={busy} className={className}>
      {body}
    </Card>
  );

  if (q.isLoading && !s) return frame(<Loading rows={6} note="Checking CIS results and open vulnerabilities for each PCI-scope asset…" />);
  if (!s) return frame(<Unavailable what="PCI compliance" href={PCI_HREF} />);
  if (!s.total) {
    return frame(
      <Empty icon={<Landmark size={16} />} title="No assets in PCI scope"
        body="Mark the assets that store, process or transmit cardholder data as PCI scope in the inventory, and their CIS hardening and open vulnerabilities are tracked here."
        href={PCI_HREF} cta="Open the inventory" />,
    );
  }

  const parts: Part[] = [
    { key: 'ok', label: 'Compliant', n: s.compliant, c: BAND.contained.c },
    { key: 'risk', label: 'At risk', n: s.atRisk, c: SEV.critical.c },
  ];
  const reasonRows: BarRow[] = PCI_REASONS.filter((r) => s.reasons[r] > 0).map((r) => ({
    key: r, label: REASON[r].label(s.threshold), n: s.reasons[r], c: REASON[r].c, title: REASON[r].tip,
  }));
  const shown = s.worst.slice(0, MAX_ROWS);

  return frame(
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div className="min-w-0">
          <Eyebrow>Compliance</Eyebrow>
          <p className="m-0 mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[30px] font-semibold leading-none tabular-nums text-[#0F172A]">{share(s.compliant, s.total)}</span>
            <span className="text-[11.5px] text-[#64748B]">{nfmt(s.compliant)} of {plural(s.total, 'asset')} compliant</span>
          </p>
        </div>
        <Figure label="PCI-scope assets" value={nfmt(s.total)} sub={`${nfmt(s.cisScanned)} of ${nfmt(s.total)} CIS-scanned`} />
      </div>

      <div className="mt-3"><StackBar parts={parts} label="PCI-scope assets by compliance" height={12} /></div>
      <div className="mt-2.5"><PartLegend parts={parts} total={s.total} cols={2} /></div>

      {/* flex-1: takes any height the row adds, so nothing leaves a white bottom */}
      <div className="mt-3 flex flex-1 flex-col border-t border-[#F1F3F7] pt-3">
        {s.atRisk === 0 ? (
          <div className="my-auto flex items-center gap-2.5 rounded-[12px] bg-[#E7F5EE] px-4 py-3.5 text-[12.5px] font-semibold text-[#047857]">
            <CheckCircle2 size={18} aria-hidden className="shrink-0" />
            Every PCI-scope asset meets the definition — CIS ≥ {s.threshold}% and no open critical, high or KEV vulnerability.
          </div>
        ) : (
          <>
            <Eyebrow className="mb-2">Why assets are at risk</Eyebrow>
            <BarList rows={reasonRows} max={s.total} labelWidth={210} />

            <Eyebrow className="mb-1.5 mt-4">Worst at-risk assets</Eyebrow>
            <div className="-mx-[14px] -mb-[6px]">
              <table className="w-full table-fixed" style={{ borderCollapse: 'collapse' }}>
                <caption className="sr-only">PCI-scope assets that are not compliant, worst first</caption>
                <colgroup>
                  <col />
                  <col style={{ width: 84 }} />
                  <col style={{ width: 84 }} />
                  <col style={{ width: 48 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...th, textAlign: 'left', paddingLeft: 14 }}>Asset</th>
                    <th scope="col" style={{ ...th, textAlign: 'left' }}>CIS</th>
                    <th scope="col" style={{ ...th, textAlign: 'left' }}>Crit · High</th>
                    <th scope="col" style={{ ...th, textAlign: 'right', paddingRight: 14 }}>KEV</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => <WorstRow key={a.id} a={a} threshold={s.threshold} />)}
                </tbody>
              </table>
            </div>
            {s.worst.length > shown.length && (
              <p className="m-0 mt-2 text-[11px] text-[#64748B]">
                +{nfmt(s.worst.length - shown.length)} more at-risk {s.worst.length - shown.length === 1 ? 'asset' : 'assets'} ·{' '}
                <Link href={PCI_HREF} className="font-semibold text-[#005B96] hover:text-[#014A81]">see all PCI assets</Link>
              </p>
            )}
          </>
        )}
      </div>

      <p className="m-0 mt-auto pt-3 text-[10.5px] leading-[1.45] text-[#94A3B8]">
        Compliant = CIS pass rate ≥ {s.threshold}% and no open critical/high or CISA-KEV vulnerability. An asset with no CIS scan can’t be shown as compliant.
        {s.vulnTruncated ? ' Vulnerability data covers only the 200 highest-priority assets; PCI assets outside it count as unverified.' : ''}
      </p>
    </div>,
  );
}

function WorstRow({ a, threshold }: { a: PciAssetState; threshold: number }) {
  const why = a.reasons.map((r) => REASON[r].label(threshold)).join(' · ');
  const sub = a.criticality ? `${cap(a.criticality)} criticality` : a.ip;
  return (
    <tr title={why}>
      <td style={{ ...td, paddingLeft: 14 }}>
        <Link href={`/cyber-assurance/assets/${a.id}`} className="block truncate font-semibold text-[#0F172A] hover:text-[#005B96]" title={a.name}>{a.name}</Link>
        {sub && <span className="block truncate text-[10.5px] font-medium text-[#64748B]">{sub}</span>}
      </td>
      <td style={td}>
        {a.cisScanned && a.cisPassRate != null
          ? <b className="font-semibold tabular-nums" style={{ color: a.cisPassRate < threshold ? SEV.critical.ink : T.text }}>{pctLabel(a.cisPassRate)}</b>
          : <span className="text-[11.5px] text-[#94A3B8]">Not scanned</span>}
      </td>
      <td style={td}>
        {a.vulnKnown ? (
          <span className="inline-flex items-center gap-2 tabular-nums" aria-label={`${a.critical} critical, ${a.high} high`}>
            {([['critical', a.critical], ['high', a.high]] as const).map(([sev, n]) => (
              <span key={sev} className="inline-flex items-center gap-1" style={{ color: n ? T.text : T.faint, fontWeight: n ? 600 : 400 }}>
                <i aria-hidden className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: n ? SEV[sev].c : '#E2E8F0' }} />{n}
              </span>
            ))}
          </span>
        ) : <span className="text-[11.5px] text-[#94A3B8]" title="Vulnerability data was capped before reaching this asset">unverified</span>}
      </td>
      <td style={{ ...td, paddingRight: 14, textAlign: 'right', fontWeight: a.kev ? 600 : 400, fontVariantNumeric: 'tabular-nums', color: a.kev ? SEV.critical.ink : T.faint }}>
        {a.vulnKnown ? nfmt(a.kev) : '—'}
      </td>
    </tr>
  );
}
