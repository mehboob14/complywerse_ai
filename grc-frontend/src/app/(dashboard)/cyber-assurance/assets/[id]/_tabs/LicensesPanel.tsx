'use client';

/*
 * LicensesPanel — asset-detail "Licenses" tab.
 *
 * For THIS asset: each installed product with its license status (Licensed /
 * Unlicensed / Over-deployed / Expiring) and the entitlement that covers it. A
 * self-contained panel over one endpoint (GET /licenses/asset/{id}), laid out like
 * SoftwarePanel next to it: summary card, search / filter row, table.
 *
 * Honesty notes (kept in the UI, not just here):
 *   - Status is a comparison of detected software against the entitlements recorded
 *     under Licenses. Scans do not collect product keys or activation state, so a
 *     "Licensed" row is not proof the copy is genuinely activated — the footer says so.
 *   - Nothing is shown for software the scan never saw; an asset with no scan reports
 *     an empty state, not "0 unlicensed".
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowUpRight, Plus, Search } from 'lucide-react';
import { licensesApi, type AssetLicense } from '@/cyber-assurance/lib/api';
import { usePermissions } from '@/cyber-assurance/hooks/usePermissions';
import { LICENSE_PERMS, humanize, normStatus } from '../../../licenses/_components/lib';

/* ── product tokens, as SoftwarePanel ── */
const AC = '#005B96';
const RED = '#B23A3A';
const RED_BG = '#FBEAEA';
const AMBER = '#9A6410';
const AMBER_BG = '#FBF2DF';
const GREEN = '#1F7A54';
const GREEN_BG = '#E7F5EE';
const INK = '#0F1F2B';
const SEC = '#3A4653';
const MUTED = '#8A95A1';
const FAINT = '#AEB8C2';
const BORDER = '#E8ECEE';
const BORDER2 = '#F0F3F5';

const CARD = 'bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,.04)]';
const CH = 'flex items-center gap-2.5 px-4 py-[13px] border-b border-[#F0F3F5]';
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '9px 14px', fontSize: 9.5, letterSpacing: '.04em',
  textTransform: 'uppercase', color: MUTED, fontWeight: 600,
  background: '#FAFBFC', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
};
const selStyle: React.CSSProperties = {
  height: 33, borderRadius: 10, padding: '0 10px', fontSize: 12, color: SEC, fontFamily: 'inherit',
};

type StatusStyle = { label: string; fg: string; bg: string; bar: string; rank: number };
// The four statuses the endpoint defines. Anything else is shown verbatim in neutral grey.
const STATUS: Record<string, StatusStyle> = {
  unlicensed: { label: 'Unlicensed', fg: RED, bg: RED_BG, bar: RED, rank: 0 },
  over_deployed: { label: 'Over-deployed', fg: RED, bg: RED_BG, bar: '#D9767A', rank: 1 },
  expiring: { label: 'Expiring', fg: AMBER, bg: AMBER_BG, bar: '#E3B341', rank: 2 },
  licensed: { label: 'Licensed', fg: GREEN, bg: GREEN_BG, bar: GREEN, rank: 3 },
};
const styleOf = (status?: string | null): StatusStyle =>
  STATUS[normStatus(status)] ?? { label: humanize(status) || 'Unknown', fg: '#6B7787', bg: '#F1F4F6', bar: FAINT, rank: 4 };

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="text-center border border-dashed" style={{ padding: '20px 16px', borderRadius: 10, borderColor: BORDER, background: '#FAFBFC' }}>
      <div style={{ fontSize: 13, color: MUTED, fontWeight: 500 }}>{text}</div>
      {hint && <div style={{ fontSize: 11.5, color: FAINT, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function StatusChip({ status }: { status?: string | null }) {
  const st = styleOf(status);
  return (
    <span className="inline-flex items-center rounded-md font-semibold whitespace-nowrap" style={{ fontSize: 10.5, padding: '2px 8px', background: st.bg, color: st.fg }}>
      {st.label}
    </span>
  );
}

const addLicenseHref = (r: AssetLicense) =>
  `/licenses?add=1&publisher=${encodeURIComponent(r.publisher ?? '')}&product=${encodeURIComponent(r.detected_name)}`;

export default function LicensesPanel({ assetId }: { assetId: number }) {
  const { hasPermission } = usePermissions();
  const canAdd = hasPermission(LICENSE_PERMS.create);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const q = useQuery({
    queryKey: ['licenses', 'asset', assetId],
    queryFn: async () => (await licensesApi.getAssetLicenses(assetId)).data,
  });
  const items = useMemo(() => q.data?.licenses ?? [], [q.data]);
  // false → the asset has never had a software inventory collected (as opposed to "nothing to check")
  const noInventory = q.data?.inventory_collected === false;

  // Per-status tallies, in worst-first order, only for statuses actually present.
  const tallies = useMemo(() => {
    const by: Record<string, { key: string; st: StatusStyle; n: number }> = {};
    items.forEach((r) => {
      const key = normStatus(r.status) || 'unknown';
      (by[key] ||= { key, st: styleOf(r.status), n: 0 }).n += 1;
    });
    return Object.keys(by).map((k) => by[k]).sort((a, b) => a.st.rank - b.st.rank);
  }, [items]);
  const count = (key: string) => tallies.find((t) => t.key === key)?.n ?? 0;

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return items
      .filter((r) => (statusFilter === 'all' || (normStatus(r.status) || 'unknown') === statusFilter)
        && (!t || r.detected_name.toLowerCase().includes(t) || (r.publisher ?? '').toLowerCase().includes(t)
          || (r.entitlement_product ?? '').toLowerCase().includes(t)))
      .sort((a, b) => styleOf(a.status).rank - styleOf(b.status).rank || a.detected_name.localeCompare(b.detected_name));
  }, [items, search, statusFilter]);
  const shown = Math.min(filtered.length, 200);

  const problems = count('unlicensed') + count('over_deployed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'var(--font-poppins), Poppins, system-ui, sans-serif', fontSize: 13.5, color: INK }}>

      {/* ===== SUMMARY ===== */}
      <div className={CARD} style={{ overflow: 'hidden' }}>
        <div className={CH}>
          <h4 className="flex-1" style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>Software licensing</h4>
          <Link href="/cyber-assurance/licenses" className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ fontSize: 11.5, color: AC }}>
            Open Licenses<ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        {q.isPending && !q.isError ? (
          <div className="px-5 py-6"><Empty text="Loading…" /></div>
        ) : q.isError ? (
          <div className="px-5 py-6"><Empty text="License status couldn't be loaded." hint="The license service didn't respond. The rest of this asset is unaffected." /></div>
        ) : items.length === 0 ? (
          <div className="px-5 py-6">
            {noInventory
              ? <Empty text="No software inventory has been collected for this asset yet." hint="License status is derived from the software found by a credentialed scan. Run a scan from the Compliance tab to populate this." />
              : <Empty text="Nothing on this asset to license-check." hint="Windows roles, background processes and Linux packages are not flagged on their own — they only appear here when an entitlement covers them." />}
          </div>
        ) : (
          <>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
              <div className="px-[18px] py-[14px]" style={{ borderRight: `1px solid ${BORDER2}` }}>
                <span style={{ fontSize: 11, color: MUTED }}>Installed products</span>
                <b className="tabular-nums" style={{ display: 'block', fontSize: 21, fontWeight: 600, marginTop: 3 }}>{items.length}</b>
                <span style={{ display: 'block', fontSize: 10.5, color: FAINT, marginTop: 2 }}>checked against entitlements</span>
              </div>
              {(['licensed', 'unlicensed', 'over_deployed', 'expiring'] as const).map((key) => {
                const n = count(key);
                const st = STATUS[key];
                return (
                  <div key={key} className="px-[18px] py-[14px]" style={{ borderRight: `1px solid ${BORDER2}` }}>
                    <span style={{ fontSize: 11, color: MUTED }}>{st.label}</span>
                    <b className="tabular-nums" style={{ display: 'block', fontSize: 21, fontWeight: 600, marginTop: 3, color: n > 0 && key !== 'licensed' ? st.fg : INK }}>{n}</b>
                  </div>
                );
              })}
            </div>
            <div className="px-[18px] py-[14px]" style={{ borderTop: `1px solid ${BORDER2}` }}>
              <div className="flex overflow-hidden rounded-full" style={{ height: 9, background: BORDER2 }}
                role="img" aria-label={`License status of ${items.length} installed products: ${tallies.map((t) => `${t.st.label} ${t.n}`).join(', ')}`}>
                {tallies.map((t) => (
                  <span key={t.key} title={`${t.st.label}: ${t.n}`} style={{ width: `${(t.n / items.length) * 100}%`, background: t.st.bar }} />
                ))}
              </div>
              <div className="flex flex-wrap" style={{ gap: '11px 16px', marginTop: 11 }}>
                {tallies.map((t) => (
                  <span key={t.key} className="inline-flex items-center" style={{ gap: 6, fontSize: 11.5, color: SEC }}>
                    <i className="inline-block rounded-sm" style={{ width: 7, height: 7, background: t.st.bar }} />
                    {t.st.label} · <b style={{ color: INK, fontWeight: 600 }}>{t.n}</b>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {items.length > 0 && (
        <>
          {/* ===== SEARCH / FILTER ROW ===== */}
          <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
            <div className="relative" style={{ width: 260 }}>
              <Search className="h-3.5 w-3.5 absolute pointer-events-none" style={{ left: 10, top: 10, color: FAINT }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search installed software…"
                aria-label="Search installed software"
                className="border border-[#E8ECEE] bg-white focus:outline-none focus:border-[#005B96]"
                style={{ width: '100%', height: 33, borderRadius: 10, padding: '0 10px 0 30px', fontSize: 12, fontFamily: 'inherit', color: INK }}
              />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by license status" className="border border-[#E8ECEE] bg-white cursor-pointer" style={selStyle}>
              <option value="all">All statuses</option>
              {tallies.map((t) => <option key={t.key} value={t.key}>{t.st.label} ({t.n})</option>)}
            </select>
            <span className="tabular-nums" style={{ marginLeft: 'auto', fontSize: 11.5, color: FAINT }}>{shown} of {items.length} shown</span>
          </div>

          {/* ===== LICENSE STATUS TABLE ===== */}
          <div className={CARD} style={{ overflow: 'hidden' }}>
            <div className={CH}>
              <h4 className="flex-1" style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>
                License status by installed product
                {problems > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: RED }}>{problems} need attention</span>}
              </h4>
            </div>
            {filtered.length === 0 ? (
              <div className="px-5 py-6"><Empty text="No software matches your filters." /></div>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                    <thead>
                      <tr>
                        {['Software', 'Version', 'Publisher', 'License status', 'Covered by', ''].map((h, i) => (
                          <th key={h || i} style={TH}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 200).map((r, i) => (
                        <tr key={`${r.software_key ?? r.detected_name}-${i}`} style={{ borderBottom: `1px solid ${BORDER2}` }}>
                          <td style={{ padding: '8px 14px', fontSize: 11.8, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>{r.detected_name}</td>
                          <td className="font-mono" style={{ padding: '8px 14px', fontSize: 11.5, color: SEC, whiteSpace: 'nowrap' }}>{r.detected_version || '—'}</td>
                          <td style={{ padding: '8px 14px', fontSize: 11.8, color: SEC, whiteSpace: 'nowrap' }}>{r.publisher || '—'}</td>
                          <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                            <span title={r.note || undefined}><StatusChip status={r.status} /></span>
                            {r.reclaim_candidate && (
                              <span className="ml-2 font-semibold" style={{ fontSize: 10.5, color: AMBER }}
                                title="This host hasn't been seen for 90+ days, so its seat may be idle and could be reassigned. A proxy for idleness — not usage metering.">
                                Reclaim candidate
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 14px', fontSize: 11.8, whiteSpace: 'nowrap' }}>
                            {r.entitlement_id != null ? (
                              <Link href={`/cyber-assurance/licenses?entitlement=${r.entitlement_id}`} className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: AC }}>
                                {r.entitlement_product || `Entitlement #${r.entitlement_id}`}<ArrowUpRight className="h-3 w-3" />
                              </Link>
                            ) : <span style={{ color: FAINT }}>No entitlement on record</span>}
                          </td>
                          <td style={{ padding: '8px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {canAdd && normStatus(r.status) === 'unlicensed' && (
                              <Link href={addLicenseHref(r)} className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ fontSize: 11.5, color: AC }}>
                                <Plus className="h-3 w-3" />Add license
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '11px 16px', fontSize: 11, color: MUTED }}>
                  <span><b className="tabular-nums" style={{ color: SEC }}>{shown}</b> of <b className="tabular-nums" style={{ color: SEC }}>{items.length}</b> installed products shown{filtered.length > shown ? ' — narrow with search to see the rest' : ''}</span>
                  <span>Worst first · from the detected-software inventory</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* honest scope note — mirrors the NotStored banners used elsewhere on the asset record */}
      {!q.isError && (
        <div className="flex items-start" style={{ gap: 9, background: AMBER_BG, border: '1px solid #E4D3A0', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, color: '#6E5410' }}>
          <AlertCircle className="h-3.5 w-3.5" style={{ flex: 'none', marginTop: 1 }} />
          <span>
            <b>Status compares installed software with the entitlements recorded under Licenses.</b>{' '}
            Scans do not collect product keys or activation state, so &ldquo;Licensed&rdquo; shows that an entitlement covers the product, not that this copy is genuinely activated.
          </span>
        </div>
      )}
    </div>
  );
}
