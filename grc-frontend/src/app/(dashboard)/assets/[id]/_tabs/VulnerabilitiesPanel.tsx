'use client';

/*
 * VulnerabilitiesPanel — the asset-detail "Vulnerabilities" tab (activeTab === 'vulnerabilities'),
 * restyled to the approved mint-teal mock (asset-record-mocks/Vulnerabilities.html): 4 severity
 * tiles + a stacked severity bar, a by-status legend, a search/severity filter row, and a dense
 * paginated findings table. Palette/type: mint-teal (--ac #17B898 / --ac-strong #12A085) + Poppins
 * 13.5px base — same approach as the sibling _overview-design.tsx restyle (Tailwind arbitrary
 * values, no dependency on inventory-redesign.css since that file isn't loaded on this route).
 *
 * PRESENTATION ONLY. Every real data source is unchanged: props, the linked_vulnerabilities list,
 * the allVulnerabilities catalogue, loading state, and the link/unlink handlers are all preserved
 * verbatim — this component fetches nothing and mutates nothing itself, the parent still owns the
 * react-query keys and mutations. Search / severity-filter / pagination are new LOCAL UI state over
 * the same already-fetched list (the mock's filter row + pager), not new data fetching.
 *
 * The mock's table has CVSS / Age / First-seen columns; LinkedVulnerabilityRow carries none of
 * those fields, so the table keeps the real columns instead (ID, Title, Severity, Status, Source,
 * Actions) rather than fabricating backend data the API doesn't return.
 *
 * AlertsPanel is a SHARED component (used across entities) that fetches its own data from its
 * assetId/canEdit props — it is rendered unchanged, exactly as the tab does today.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Bug, Search, X } from 'lucide-react';
import { InlineLinkPicker } from '@/components/ui';
import { AlertsPanel } from '@/components/shared/EntityExtras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Statuses that mean a finding is no longer an open item on this asset — the same closed-set
 *  page.tsx uses (register / alerts agree), duplicated here only to count "open" for the header. */
const CLOSED_VULN_STATUSES = new Set([
  'remediated', 'verified', 'closed', 'resolved', 'accepted', 'false_positive', 'auto_closed_decommissioned', 'auto_closed_fixed',
]);
const isOpenVuln = (v: { status?: string | null }) =>
  !CLOSED_VULN_STATUSES.has((v.status || '').toLowerCase());

export interface LinkedVulnerabilityRow {
  link_id?: number;
  vulnerability_id: number;
  vuln_id?: string | null;
  title?: string | null;
  severity?: string | null;
  status?: string | null;
  link_source?: string | null;
  auto_linked?: boolean | null;
}

export interface VulnerabilitiesPanelProps {
  /** For the shared AlertsPanel (self-fetching) at the top of the tab. */
  assetId: number;
  canEdit: boolean;
  /** The asset — only linked_vulnerabilities is read here. */
  asset: { linked_vulnerabilities?: LinkedVulnerabilityRow[] };
  /** The full vulnerability catalogue for the "Link" picker. */
  allVulnerabilities: Array<{ id: number; vuln_id?: string; title?: string; severity?: string; status?: string }>;
  vulnsLoading: boolean;
  onLinkVulnerability: (vulnId: number) => void;
  isLinking: boolean;
  onUnlinkVulnerability: (vulnId: number) => void;
  isUnlinking: boolean;
}

const PAGE_SIZE = 10;

// mock-matched palette (asset-record-mocks/Vulnerabilities.html :root) — severity → {tile text, chip}
const SEV: Record<string, { text: string; chip: string }> = {
  critical: { text: 'text-[#B23A3A]', chip: 'text-[#B23A3A] bg-[#FBEAEA]' },
  high: { text: 'text-[#C0682F]', chip: 'text-[#C0682F] bg-[#FCEEE2]' }, // mock's own literal rust — no named var, used verbatim
  medium: { text: 'text-[#9A6410]', chip: 'text-[#9A6410] bg-[#FBF2DF]' },
  low: { text: 'text-[#AEB8C2]', chip: 'text-[#8A95A1] bg-[#F0F3F5]' },
};
const SEV_FALLBACK = { text: 'text-[#8A95A1]', chip: 'text-[#8A95A1] bg-[#F0F3F5]' };
const SEV_DOT: Record<string, string> = { critical: 'bg-[#B23A3A]', high: 'bg-[#C0682F]', medium: 'bg-[#9A6410]', low: 'bg-[#AEB8C2]' };

// status → {label, dot, chip}
const STATUS: Record<string, { label: string; dot: string; chip: string }> = {
  open: { label: 'Open', dot: 'bg-[#2E63A8]', chip: 'text-[#2E63A8] bg-[#E9F1FB]' },
  in_progress: { label: 'In progress', dot: 'bg-[#6A54C9]', chip: 'text-[#6A54C9] bg-[#EEEBFA]' },
  resolved: { label: 'Resolved', dot: 'bg-[#1F7A54]', chip: 'text-[#1F7A54] bg-[#E7F5EE]' },
  accepted: { label: 'Accepted', dot: 'bg-[#8A95A1]', chip: 'text-[#8A95A1] bg-[#F0F3F5]' },
  false_positive: { label: 'False positive', dot: 'bg-[#8A95A1]', chip: 'text-[#8A95A1] bg-[#F0F3F5]' },
};
const statusMeta = (key: string) =>
  STATUS[key] || { label: key ? key.replace(/_/g, ' ') : 'Unknown', dot: 'bg-[#8A95A1]', chip: 'text-[#8A95A1] bg-[#F0F3F5]' };

const MONO = "font-['ui-monospace','Cascadia_Code',Consolas,monospace] [font-variant-numeric:tabular-nums]";
const NUM = '[font-variant-numeric:tabular-nums]';
const CARD = 'bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,0.04)]';
const TH = 'text-left px-3.5 py-[9px] text-[9.5px] uppercase tracking-[0.04em] text-[#8A95A1] font-semibold bg-[#FAFBFC] border-b border-[#E8ECEE] whitespace-nowrap';
const TD = 'px-3.5 py-[9px] text-[11.8px] text-[#3A4653] border-b border-[#F0F3F5] align-middle';
const BTN_PRI = 'h-[33px] px-3.5 rounded-[10px] border border-[#17B898] bg-[#17B898] text-[#06342B] text-[12px] font-semibold whitespace-nowrap hover:bg-[#12A085] hover:border-[#12A085]';
const FILTER_BTN = (on: boolean) =>
  `h-[33px] px-3 rounded-[10px] border text-[11.5px] whitespace-nowrap ${on ? 'border-[#17B898] bg-[#E4F8F2] text-[#12A085] font-semibold' : 'border-[#E8ECEE] bg-white text-[#3A4653] font-medium'}`;

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Compact page-number window with ellipsis: all pages when few, else 1,2 … cur-1,cur,cur+1 … last-1,last.
function pageWindow(cur: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = Array.from(new Set([1, 2, cur - 1, cur, cur + 1, total - 1, total]))
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  let prev = 0;
  for (const n of keep) {
    if (prev && n - prev > 1) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}

function Chip({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${cls}`}>{text}</span>;
}

function SevTile({ n, label, sub, colorCls }: { n: number; label: string; sub: string; colorCls: string }) {
  return (
    <div className="border border-[#E8ECEE] rounded-[11px] px-2 py-3 text-center min-w-0">
      <span className={`block text-[21px] font-semibold leading-none ${NUM} ${colorCls}`}>{n}</span>
      <span className="block text-[11px] text-[#8A95A1] mt-[5px] uppercase tracking-[0.03em]">{label}</span>
      <span className="block text-[10.5px] text-[#AEB8C2] mt-0.5">{sub}</span>
    </div>
  );
}

export default function VulnerabilitiesPanel({
  assetId,
  canEdit,
  asset,
  allVulnerabilities,
  vulnsLoading,
  onLinkVulnerability,
  isLinking,
  onUnlinkVulnerability,
  isUnlinking,
}: VulnerabilitiesPanelProps) {
  const linked = asset.linked_vulnerabilities ?? [];
  const linkedVulnIds = linked.map((v) => v.vulnerability_id);

  // Picker items — same shape/derivation as the tab today (exclude already-linked).
  const vulnPickerItems = allVulnerabilities
    .filter((v) => !linkedVulnIds.includes(v.id))
    .map((v) => {
      const code = v.vuln_id || `VULN-${v.id}`;
      const title = v.title || 'Untitled vulnerability';
      const sev = v.severity ? ` · ${v.severity}` : '';
      return {
        value: String(v.id),
        label: `${code} — ${title}`,
        subLabel: `${(v.status || '').replace(/_/g, ' ')}${sev}`.trim() || undefined,
      };
    });

  const openCount = linked.filter(isOpenVuln).length;
  const totalCount = linked.length;
  const sevCount = (s: string) => linked.filter((v) => (v.severity || '').toLowerCase() === s).length;
  const critN = sevCount('critical');
  const highN = sevCount('high');
  const medN = sevCount('medium');
  const lowN = sevCount('low');
  const pct = (n: number) => (totalCount > 0 ? `${((n / totalCount) * 100).toFixed(1)}% of total` : '—');

  const statusCounts = linked.reduce<Record<string, number>>((acc, v) => {
    const key = (v.status || 'unknown').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Local UI state — filtering/paginating the same `linked` list above; no extra fetch.
  const [search, setSearch] = useState('');
  const [sevFilter, setSevFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filtered = linked.filter((v) => {
    if (sevFilter && (v.severity || '').toLowerCase() !== sevFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${v.vuln_id || ''} ${v.title || ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const setSevAndReset = (s: string | null) => {
    setSevFilter(s);
    setPage(1);
  };

  const picker = (label: string) => (
    <InlineLinkPicker
      triggerLabel={label}
      triggerClassName={BTN_PRI}
      items={vulnPickerItems}
      isLoading={vulnsLoading || isLinking}
      emptyText="No vulnerabilities available"
      searchPlaceholder="Search vulnerabilities"
      onSelect={(value: string) => onLinkVulnerability(Number(value))}
      popoverWidth={380}
    />
  );

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Alerts sit on top — the severity ranking of the very list below, built from the same
          VulnerabilityAssetLink join. Shared component, self-fetching, rendered unchanged. */}
      <AlertsPanel assetId={assetId} canEdit={canEdit} />

      {totalCount > 0 ? (
        <>
          {/* summary: severity tiles + stacked bar + by-status split */}
          <div className={CARD}>
            <div className="grid grid-cols-4 gap-[10px] px-4 py-[15px]">
              <SevTile n={critN} label="Critical" sub={pct(critN)} colorCls={SEV.critical.text} />
              <SevTile n={highN} label="High" sub={pct(highN)} colorCls={SEV.high.text} />
              <SevTile n={medN} label="Medium" sub={pct(medN)} colorCls={SEV.medium.text} />
              <SevTile n={lowN} label="Low" sub={pct(lowN)} colorCls={SEV.low.text} />
            </div>

            <div className="border-t border-[#F0F3F5] px-4 py-[13px]">
              <div className="text-[11px] text-[#8A95A1] mb-2">Findings by severity · {totalCount} total</div>
              <div className="flex h-[9px] rounded-full overflow-hidden bg-[#F0F3F5]">
                <span className={SEV_DOT.critical} style={{ width: `${(critN / totalCount) * 100}%` }} />
                <span className={SEV_DOT.high} style={{ width: `${(highN / totalCount) * 100}%` }} />
                <span className={SEV_DOT.medium} style={{ width: `${(medN / totalCount) * 100}%` }} />
                <span className={`flex-1 ${SEV_DOT.low}`} />
              </div>
            </div>

            <div className="border-t border-[#F0F3F5] px-4 py-3">
              <div className="text-[11px] text-[#8A95A1] mb-2">By status</div>
              <div className="flex flex-wrap gap-x-[18px] gap-y-2.5">
                {Object.entries(statusCounts).map(([key, n]) => {
                  const meta = statusMeta(key);
                  return (
                    <span key={key} className="flex items-center gap-1.5 text-[11.5px] text-[#3A4653]">
                      <i className={`inline-block w-[7px] h-[7px] rounded-full ${meta.dot}`} />
                      {meta.label} · <b className={`text-[#0F1F2B] font-semibold ${NUM}`}>{n}</b>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* search / severity filter row */}
          <div className="flex flex-wrap items-center gap-[7px]">
            <div className="relative w-[260px]">
              <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[#AEB8C2] pointer-events-none" strokeWidth={1.8} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={`Search ${totalCount} findings by ID or title…`}
                className="w-full h-[33px] rounded-[10px] border border-[#E8ECEE] bg-white pl-[30px] pr-2.5 text-[12px] text-[#0F1F2B] outline-none focus:border-[#17B898]"
              />
            </div>
            <button onClick={() => setSevAndReset(null)} className={FILTER_BTN(sevFilter === null)}>
              All {totalCount}
            </button>
            {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
              <button key={s} onClick={() => setSevAndReset(s)} className={FILTER_BTN(sevFilter === s)}>
                {cap(s)} {sevCount(s)}
              </button>
            ))}
          </div>

          {/* findings table */}
          <div className={CARD + ' overflow-hidden'}>
            <div className="flex items-center gap-2.5 px-4 py-[13px] border-b border-[#F0F3F5] flex-wrap">
              <div className="flex-1 flex items-center gap-2 text-[12.5px] font-semibold text-[#0F1F2B] min-w-0">
                <Bug size={15} className="flex-none text-[#1F7A54]" strokeWidth={2} />
                Vulnerability findings
                <span className="text-[11px] font-medium text-[#8A95A1] whitespace-nowrap">
                  {openCount} open{totalCount !== openCount ? ` · ${totalCount} total` : ''}
                </span>
              </div>
              {picker('Link Vulnerability')}
            </div>

            {pageRows.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="border-collapse w-full">
                    <thead>
                      <tr>
                        <th className={TH}>CVE / ID</th>
                        <th className={TH}>Title</th>
                        <th className={TH}>Severity</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Source</th>
                        <th className={TH + ' text-right'}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((vuln) => {
                        const sevKey = (vuln.severity || '').toLowerCase();
                        const stKey = (vuln.status || '').toLowerCase();
                        const sevTone = SEV[sevKey] || SEV_FALLBACK;
                        const stMeta = statusMeta(stKey);
                        return (
                          <tr key={`${vuln.vulnerability_id}-${vuln.link_id || 'link'}`} className="hover:bg-[#F7FBFA]">
                            <td className={TD + ' ' + MONO + ' text-[10.5px] text-[#8A95A1] whitespace-nowrap'}>
                              {vuln.vuln_id || `VULN-${vuln.vulnerability_id}`}
                            </td>
                            <td className={TD}>
                              <span className="font-semibold text-[#0F1F2B] text-[11.8px]" style={{ overflowWrap: 'anywhere' }}>
                                {vuln.title || `Vulnerability #${vuln.vulnerability_id}`}
                              </span>
                            </td>
                            <td className={TD}>
                              <Chip text={vuln.severity || 'unknown'} cls={sevTone.chip} />
                            </td>
                            <td className={TD}>
                              <Chip text={stMeta.label} cls={stMeta.chip} />
                            </td>
                            <td className={TD + ' whitespace-nowrap'}>
                              {vuln.auto_linked ? (
                                <span
                                  title="Linked automatically by scanner / sync / matcher — review for accuracy"
                                  className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#1F7A54]"
                                >
                                  Auto
                                </span>
                              ) : vuln.link_source && vuln.link_source !== 'manual' ? (
                                <span className="text-[11px] uppercase tracking-[0.04em] text-[#AEB8C2]">
                                  {vuln.link_source.replace(/_/g, ' ')}
                                </span>
                              ) : (
                                <span className="text-[11.8px] text-[#AEB8C2]">manual</span>
                              )}
                            </td>
                            <td className={TD + ' whitespace-nowrap text-right'}>
                              <Link href={`/vulnerabilities/${vuln.vulnerability_id}`} className="text-[11.8px] font-semibold text-[#12A085]">
                                View
                              </Link>
                              <button
                                onClick={() => onUnlinkVulnerability(vuln.vulnerability_id)}
                                disabled={isUnlinking}
                                title="Unlink Vulnerability"
                                className="ml-2.5 align-middle p-1 rounded-md bg-transparent border-none text-[#AEB8C2] disabled:opacity-50"
                                style={{ cursor: isUnlinking ? 'default' : 'pointer' }}
                              >
                                <X size={14} className="inline" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between gap-2.5 px-4 py-[11px] text-[11px] text-[#8A95A1] flex-wrap">
                  <span>
                    Showing{' '}
                    <b className={`text-[#3A4653] ${NUM}`}>
                      {(curPage - 1) * PAGE_SIZE + 1}–{Math.min(curPage * PAGE_SIZE, filtered.length)}
                    </b>{' '}
                    of <b className={`text-[#3A4653] ${NUM}`}>{filtered.length}</b> finding{filtered.length === 1 ? '' : 's'}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        className="h-[26px] min-w-[26px] px-1.5 rounded-[7px] border border-[#E8ECEE] bg-white text-[#3A4653] text-[11px] disabled:text-[#AEB8C2]"
                        disabled={curPage === 1}
                        onClick={() => setPage(curPage - 1)}
                      >
                        ‹
                      </button>
                      {pageWindow(curPage, totalPages).map((p, i) =>
                        p === '…' ? (
                          <span key={`dots-${i}`} className="px-[3px] text-[#AEB8C2] text-[11px]">
                            …
                          </span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setPage(p)}
                            className={`h-[26px] min-w-[26px] px-1.5 rounded-[7px] border text-[11px] ${
                              p === curPage ? 'border-[#17B898] bg-[#17B898] text-[#06342B] font-semibold' : 'border-[#E8ECEE] bg-white text-[#3A4653]'
                            }`}
                          >
                            {p}
                          </button>
                        )
                      )}
                      <button
                        className="h-[26px] min-w-[26px] px-1.5 rounded-[7px] border border-[#E8ECEE] bg-white text-[#3A4653] text-[11px] disabled:text-[#AEB8C2]"
                        disabled={curPage === totalPages}
                        onClick={() => setPage(curPage + 1)}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center px-5 py-8 text-[12.5px] text-[#8A95A1]">No findings match your filters.</div>
            )}
          </div>
        </>
      ) : (
        // empty-state — same copy + picker as the tab today
        <div className={CARD + ' flex flex-col items-center justify-center text-center px-5 py-12'}>
          <div className="w-14 h-14 rounded-[14px] bg-[#F4F6F7] border border-[#E8ECEE] flex items-center justify-center mb-4">
            <Bug className="h-7 w-7 text-[#AEB8C2]" strokeWidth={2} />
          </div>
          <div className="text-[15px] font-semibold text-[#0F1F2B]">No Vulnerabilities Linked</div>
          <div className="text-[13px] text-[#8A95A1] mt-1">Link vulnerabilities to track asset exposure</div>
          <div className="mt-4">{picker('Link First Vulnerability')}</div>
        </div>
      )}
    </div>
  );
}
