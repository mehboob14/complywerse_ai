'use client';

/*
 * SoftwarePanel — asset-detail "Software" tab, restyled to the mint-teal
 * record-page mock (asset-record-mocks/Software.html: summary + category
 * breakdown, search/filter row, installed-software table).
 *
 * PRESENTATION ONLY. Same props, same data sources (the
 * ['asset-detected-software', assetId] and ['asset-software-identifiers', assetId]
 * queries), same mutation (remove identifier), same capabilities (row click
 * opens SoftwareSetupDrawer, promoted/"own asset" badge, permission-gated
 * identifier removal, loading/empty states, every GuideMarker) as the prior
 * panel — only the render changed.
 *
 * Honest substitutions where the mock assumes data the backend doesn't have:
 *   - The mock's per-row "Category" column and its "By category" breakdown use
 *     a fixed taxonomy (Browser/Database/Developer tools/…) with no backing
 *     field on a detected-software entry — a collected entry is only ever
 *     {name, version, publisher, source} (see agentless_inventory.py). The
 *     breakdown below instead uses the REAL, already-computed
 *     `security_posture.categories` (security_classifier.py) and its labels;
 *     the per-row column shows the real collection `source`
 *     (agent/registry/scan/…) instead of a fabricated category chip.
 *   - The mock's "First seen"/"Last seen" columns don't exist server-side
 *     either; that table space is used for the real "Tracked separately"
 *     promoted-status pill + the row's click-through affordance — both real
 *     behavior carried over from the previous panel.
 *   - The mock's "Nessus · 2026-08-25" scan byline is demo flavor text; the
 *     real subtext uses `security_posture.computed_at` when present and is
 *     omitted otherwise, instead of inventing a scan tool/date.
 *   - The search box + two filter dropdowns are new, but are plain
 *     client-side filters over the already-fetched inventory — no new
 *     endpoint or query key.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, X, ShieldCheck, ShieldAlert, Search,
} from 'lucide-react';
import { assetsApi, softwareIdentifiersApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';
import {
  SoftwareSetupDrawer,
  type SoftwareSetupEntry,
} from '@/components/assets/SoftwareSetupDrawer';

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ── mint-teal tokens, matching Software.html exactly ── */
const AC = '#17B898';
const AC_STRONG = '#12A085';
const AC_SOFT = '#E4F8F2';
const BLUE = '#2E63A8';
const BLUE_BG = '#E9F1FB';
const VIOLET = '#6A54C9';
const VIOLET_BG = '#EEEBFA';
const RED = '#B23A3A';
const RED_BG = '#FBEAEA';
const AMBER = '#9A6410';
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

// Real security-posture categories (security_classifier.py) — same labels the
// prior panel used, now driving the mock's "By category" breakdown.
const CAT_LABELS: Record<string, string> = {
  antivirus: 'Antivirus', edr: 'EDR / XDR', database: 'Databases',
  web_server: 'Web servers', backup: 'Backup', remote_access: 'Remote access',
  vpn: 'VPN', container: 'Containers', monitoring: 'Monitoring', application: 'Other apps',
};
const CAT_COLORS = [AC, BLUE, VIOLET, AMBER, GREEN, RED, FAINT];

const SOURCE_STYLES: Record<string, { bg: string; fg: string }> = {
  agent: { bg: AC_SOFT, fg: AC_STRONG },
  registry: { bg: BLUE_BG, fg: BLUE },
  listening_process: { bg: VIOLET_BG, fg: VIOLET },
  scan: { bg: '#F1F4F6', fg: '#6B7787' },
};
function sourceStyle(s: string) {
  return SOURCE_STYLES[s] ?? SOURCE_STYLES.scan;
}
function prettySource(s: string) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="text-center border border-dashed" style={{ padding: '20px 16px', borderRadius: 10, borderColor: BORDER, background: '#FAFBFC' }}>
      <div style={{ fontSize: 13, color: MUTED, fontWeight: 500 }}>{text}</div>
      {hint && <div style={{ fontSize: 11.5, color: FAINT, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

/* ─── security posture (derived from installed-software inventory) ──────── */

function PostureSignal({ present, label, products }: { present: boolean; label: string; products: string[] }) {
  return (
    <div
      className="flex-1"
      style={{
        minWidth: 160, padding: '12px 14px', borderRadius: 12,
        border: `1px solid ${present ? BORDER : '#F1C6C6'}`,
        background: present ? '#fff' : RED_BG,
      }}
    >
      <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
      <div className="flex items-center" style={{ gap: 8, marginTop: 6 }}>
        {present
          ? <ShieldCheck className="h-4 w-4 flex-shrink-0" strokeWidth={2} style={{ color: GREEN }} />
          : <ShieldAlert className="h-4 w-4 flex-shrink-0" strokeWidth={2} style={{ color: RED }} />}
        <span style={{ fontSize: 14, fontWeight: 700, color: present ? INK : RED }}>
          {present ? 'Present' : 'Not detected'}
        </span>
      </div>
      {products.length > 0 && (
        <div style={{ marginTop: 7, fontSize: 12, color: SEC }}>{products.join(', ')}</div>
      )}
    </div>
  );
}

function SecurityPostureCard({ posture }: { posture: any }) {
  if (!posture) return null;
  const protectedHost = !!posture.endpoint_protected;
  const av: string[] = posture.antivirus_products ?? [];
  const edr: string[] = posture.edr_products ?? [];

  return (
    <div className={CARD}>
      <div className={CH}>
        {protectedHost
          ? <ShieldCheck className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} style={{ color: GREEN }} />
          : <ShieldAlert className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} style={{ color: RED }} />}
        <h4 className="flex-1" style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>Security posture</h4>
        <span className="font-semibold whitespace-nowrap" style={{
          fontSize: 10.5, padding: '2px 8px', borderRadius: 6,
          background: protectedHost ? GREEN_BG : RED_BG, color: protectedHost ? GREEN : RED,
        }}>
          {protectedHost ? 'Protected' : 'Unprotected'}
        </span>
      </div>
      <div className="px-[18px] py-[14px]">
        {!protectedHost && (
          <div className="flex items-center" style={{
            gap: 9, marginBottom: 14, padding: '10px 13px', borderRadius: 10,
            background: RED_BG, border: '1px solid #F1C6C6', color: RED, fontSize: 12.5, fontWeight: 600,
          }}>
            <ShieldAlert className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
            No antivirus or EDR detected on this host.
          </div>
        )}
        <div className="flex flex-wrap" style={{ gap: 12 }}>
          <PostureSignal present={!!posture.has_antivirus} label="Antivirus" products={av} />
          <PostureSignal present={!!posture.has_edr} label="EDR / XDR" products={edr} />
        </div>
      </div>
    </div>
  );
}

/* ─── panel ────────────────────────────────────────────────────────────── */

export default function SoftwarePanel({
  assetId,
  canEdit,
  peers,
  hostName,
  hostIp,
}: {
  assetId: number;
  canEdit?: boolean;
  peers?: any[];
  hostName?: string;
  hostIp?: string;
}) {
  const qc = useQueryClient();
  const { enabled: guideEnabled } = useGuide();
  const [setupEntry, setSetupEntry] = useState<SoftwareSetupEntry | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [publisherFilter, setPublisherFilter] = useState('all');

  const detected = useQuery({
    queryKey: ['asset-detected-software', assetId],
    queryFn: async () => (await assetsApi.getDetectedSoftware(assetId)).data as any,
  });
  const identifiers = useQuery({
    queryKey: ['asset-software-identifiers', assetId],
    queryFn: async () => (await softwareIdentifiersApi.list(assetId)).data,
  });

  // The endpoint returns { asset_id, inventory: [...] }. We were only looking
  // for `software`/`items`, so this tab reported "0 detected" on every asset
  // that actually had software. Real bug, not cosmetic.
  const items: any[] = Array.isArray(detected.data)
    ? detected.data
    : (detected.data?.inventory ?? detected.data?.software ?? detected.data?.items ?? []);
  const posture = Array.isArray(detected.data) ? null : (detected.data?.security_posture ?? null);
  const ids = identifiers.data ?? [];

  const publishers = useMemo(
    () => Array.from(new Set(items.map((s: any) => s.publisher ?? s.vendor).filter(Boolean))).sort(),
    [items],
  );
  const sources = useMemo(
    () => Array.from(new Set(items.map((s: any) => s.source ?? 'scan'))).sort(),
    [items],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((s: any) => {
      if (sourceFilter !== 'all' && (s.source ?? 'scan') !== sourceFilter) return false;
      const pub = s.publisher ?? s.vendor ?? '';
      if (publisherFilter !== 'all' && pub !== publisherFilter) return false;
      if (!q) return true;
      const name = String(s.name ?? s.product ?? '').toLowerCase();
      return name.includes(q) || String(pub).toLowerCase().includes(q);
    });
  }, [items, search, sourceFilter, publisherFilter]);
  const shown = Math.min(filtered.length, 200);

  const cats: Record<string, number> = posture?.categories ?? {};
  const catEntries = Object.entries(cats).sort((a, b) => (b[1] as number) - (a[1] as number));
  const lastUpdated: string | null = posture?.computed_at ? String(posture.computed_at).slice(0, 10) : null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['asset-software-identifiers', assetId] });
    qc.invalidateQueries({ queryKey: ['asset-detected-software', assetId] });
    qc.invalidateQueries({ queryKey: ['assets', assetId, 'detected-software'] });
    qc.invalidateQueries({ queryKey: ['assets', assetId, 'ip-peers'] });
    qc.invalidateQueries({ queryKey: ['asset-detail', assetId] });
  };
  const removeId = useMutation({
    mutationFn: (identifierId: number) => softwareIdentifiersApi.delete(assetId, identifierId),
    onSuccess: refresh,
  });

  /** Already promoted to its own asset? Prefer the inventory's promoted_asset_id;
      fall back to matching a co-located peer by name. */
  const promoted = (s: any) => {
    if (s.promoted_asset_id) return true;
    const name = String(s.name ?? s.product ?? '').toLowerCase();
    if (!name) return false;
    return (peers ?? []).some((p: any) => String(p.name ?? '').toLowerCase().includes(name));
  };

  const openSetup = (s: any) => {
    const key = s.software_key ?? s.key;
    if (!key) return;
    setSetupEntry({
      software_key: String(key),
      name: s.name ?? s.product ?? String(key),
      version: s.version,
      publisher: s.publisher ?? s.vendor,
      benchmark_available: !!s.benchmark_available,
      benchmark_name: s.benchmark_name,
      rule_count: s.rule_count,
      promoted_asset_id: s.promoted_asset_id ?? null,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'var(--font-poppins), Poppins, system-ui, sans-serif', fontSize: 13.5, color: INK }}>

      {/* ===== SUMMARY + CATEGORY BREAKDOWN (Software.html: .stats + .catbar) ===== */}
      <div className={CARD} style={{ overflow: 'hidden' }}>
        {detected.isLoading ? (
          <div className="px-5 py-6"><Empty text="Loading…" /></div>
        ) : items.length === 0 ? (
          <div className="px-5 py-6">
            <Empty text="No software recorded for this asset yet." hint="Software is captured during a CIS scan or an agent heartbeat. Run a scan from the Compliance tab to populate this." />
          </div>
        ) : (
          <>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
              <div className="px-[18px] py-[14px]" style={{ borderRight: `1px solid ${BORDER2}` }}>
                <span style={{ fontSize: 11, color: MUTED }}>Installed packages</span>
                <b className="tabular-nums" style={{ display: 'block', fontSize: 21, fontWeight: 600, marginTop: 3 }}>{items.length}</b>
                {lastUpdated && <span style={{ display: 'block', fontSize: 10.5, color: FAINT, marginTop: 2 }}>detected-software scan · {lastUpdated}</span>}
              </div>
              <div className="px-[18px] py-[14px]" style={{ borderRight: `1px solid ${BORDER2}` }}>
                <span style={{ fontSize: 11, color: MUTED }}>Unique publishers</span>
                <b className="tabular-nums" style={{ display: 'block', fontSize: 21, fontWeight: 600, marginTop: 3 }}>{publishers.length}</b>
                <span style={{ display: 'block', fontSize: 10.5, color: FAINT, marginTop: 2 }}>across all detected packages</span>
              </div>
              <div className="px-[18px] py-[14px]">
                <span style={{ fontSize: 11, color: MUTED }}>Categories</span>
                <b className="tabular-nums" style={{ display: 'block', fontSize: 21, fontWeight: 600, marginTop: 3 }}>{catEntries.length}</b>
                <span style={{ display: 'block', fontSize: 10.5, color: FAINT, marginTop: 2 }}>see breakdown below</span>
              </div>
            </div>

            {catEntries.length > 0 && (
              <div className="px-[18px] py-[14px]" style={{ borderTop: `1px solid ${BORDER2}` }}>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>By category</div>
                <div className="flex overflow-hidden rounded-full" style={{ height: 9, background: BORDER2 }}>
                  {catEntries.map(([cat, n], i) => (
                    <span key={cat} style={{ width: `${((n as number) / items.length) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                  ))}
                </div>
                <div className="flex flex-wrap" style={{ gap: '11px 16px', marginTop: 11 }}>
                  {catEntries.map(([cat, n], i) => (
                    <span key={cat} className="inline-flex items-center" style={{ gap: 6, fontSize: 11.5, color: SEC }}>
                      <i className="inline-block rounded-sm" style={{ width: 7, height: 7, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                      {CAT_LABELS[cat] ?? cat} · <b style={{ color: INK, fontWeight: 600 }}>{n as number}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}
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
                className="border border-[#E8ECEE] bg-white focus:outline-none focus:border-[#17B898]"
                style={{ width: '100%', height: 33, borderRadius: 10, padding: '0 10px 0 30px', fontSize: 12, fontFamily: 'inherit', color: INK }}
              />
            </div>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="border border-[#E8ECEE] bg-white cursor-pointer" style={selStyle}>
              <option value="all">All sources</option>
              {sources.map((s) => <option key={s} value={s}>{prettySource(s)}</option>)}
            </select>
            <select value={publisherFilter} onChange={(e) => setPublisherFilter(e.target.value)} className="border border-[#E8ECEE] bg-white cursor-pointer" style={selStyle}>
              <option value="all">All publishers</option>
              {publishers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="tabular-nums" style={{ marginLeft: 'auto', fontSize: 11.5, color: FAINT }}>{shown} of {items.length} shown</span>
          </div>

          {/* ===== INSTALLED SOFTWARE TABLE ===== */}
          <div className={CARD} style={{ overflow: 'hidden' }}>
            <div className={CH}>
              <h4 className="flex-1" style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>Installed software</h4>
              <GuideMarker id="asset.swIntro" n={1} />
            </div>
            {filtered.length === 0 ? (
              <div className="px-5 py-6"><Empty text="No software matches your filters." /></div>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                    <thead>
                      <tr>
                        {['Name', 'Version', 'Publisher', 'Source', 'Tracked separately', ''].map((h, i) => (
                          <th key={h || i} style={TH}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 200).map((s: any, i: number) => {
                        const ok = promoted(s);
                        const key = s.software_key ?? s.key;
                        const clickable = Boolean(key);
                        const src = s.source ?? 'scan';
                        const srcStyle = sourceStyle(src);
                        return (
                          <tr
                            key={i}
                            onClick={clickable ? () => openSetup(s) : undefined}
                            className={clickable ? 'hover:bg-[#F7FBFA]' : undefined}
                            style={{ borderBottom: `1px solid ${BORDER2}`, cursor: clickable ? 'pointer' : undefined }}
                          >
                            <td style={{ padding: '8px 14px', fontSize: 11.8, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>{s.name ?? s.product ?? '—'}</td>
                            <td className="font-mono" style={{ padding: '8px 14px', fontSize: 11.5, color: SEC, whiteSpace: 'nowrap' }}>{s.version ?? '—'}</td>
                            <td style={{ padding: '8px 14px', fontSize: 11.8, color: SEC, whiteSpace: 'nowrap' }}>{s.publisher ?? s.vendor ?? '—'}</td>
                            <td style={{ padding: '8px 14px' }}>
                              <span className="inline-flex items-center rounded-md font-semibold whitespace-nowrap" style={{ fontSize: 10.5, padding: '2px 8px', background: srcStyle.bg, color: srcStyle.fg }}>
                                {prettySource(src)}
                              </span>
                            </td>
                            <td style={{ padding: '8px 14px' }}>
                              <span className="inline-flex items-center rounded-md font-semibold whitespace-nowrap" style={ok
                                ? { fontSize: 10.5, padding: '2px 8px', background: GREEN_BG, color: GREEN }
                                : { fontSize: 10.5, padding: '2px 8px', background: '#F1F4F6', color: '#6B7787' }}>
                                {ok ? (s.promoted_asset_id ? `Asset #${s.promoted_asset_id}` : 'Own asset') : 'Part of host'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 14px', textAlign: 'right', color: FAINT }}>
                              {clickable && <ChevronRight className="h-3.5 w-3.5 inline" />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, padding: '11px 16px', fontSize: 11, color: MUTED }}>
                  <span><b className="tabular-nums" style={{ color: SEC }}>{shown}</b> of <b className="tabular-nums" style={{ color: SEC }}>{items.length}</b> installed packages shown</span>
                  <span>Sourced from the detected-software inventory{lastUpdated ? ` · updated ${lastUpdated}` : ''}</span>
                </div>
                <p style={{ margin: 0, padding: '0 16px 14px', fontSize: 11.3, color: FAINT, lineHeight: 1.55 }}>
                  {items.length > shown && <><b>Showing first {shown} of {items.length}.</b>{' '}</>}
                  &ldquo;Part of host&rdquo; means the service is inventoried against this machine. Opening a row lets you
                  set it up as a separate asset (with credentials when the benchmark needs them). We do not
                  track end-of-life dates per package, so no EOL flag is shown — that would be a guess.
                  <GuideMarker id="asset.swPromote" n={2} className="ml-1.5" />
                </p>
              </>
            )}
          </div>
        </>
      )}

      {setupEntry && (
        <SoftwareSetupDrawer
          open
          onClose={() => setSetupEntry(null)}
          hostAssetId={assetId}
          hostName={hostName}
          hostIp={hostIp}
          entry={setupEntry}
          onComplete={refresh}
        />
      )}

      <SecurityPostureCard posture={posture} />

      {/* ===== SOFTWARE IDENTIFIERS (CPE/PURL) — real feature, not shown in the mock ===== */}
      <div className={CARD}>
        <div className={CH}>
          <h4 className="flex-1" style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>Software identifiers</h4>
          <GuideMarker id="asset.swCpe" n={3} />
        </div>
        <div className="px-[18px] py-[14px]">
          {ids.length === 0 ? (
            <Empty text="No identifiers recorded." hint="Promote a detected package to an identifier to make it vulnerability-matchable." />
          ) : (
            <div className="flex flex-col" style={{ gap: 7 }}>
              {ids.map((x: any) => (
                <div key={x.id} className="flex items-center border border-[#E8ECEE] bg-[#FAFBFC]" style={{ gap: 10, padding: '9px 12px', borderRadius: 9 }}>
                  <span className="uppercase font-semibold" style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 6, background: BLUE_BG, color: BLUE }}>{x.identifier_type}</span>
                  <span className="font-mono truncate" style={{ fontSize: 12, color: INK, minWidth: 0 }}>{x.identifier}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: FAINT, flex: 'none' }}>{x.source ?? '—'}</span>
                  {canEdit && (
                    <button
                      onClick={() => removeId.mutate(x.id)}
                      title="Remove identifier — this package will stop being CVE-matchable"
                      className="hover:opacity-70"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: FAINT, padding: 2, flex: 'none' }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {guideEnabled && (
            <div className="flex" style={{ marginTop: 12, gap: 10, fontSize: 11.5, color: FAINT }}>
              <span>How a CVE gets linked automatically: <GuideMarker id="asset.swMatching" n={4} className="mx-1" /> and why a precise version matters: <GuideMarker id="asset.swVersion" n={5} className="ml-1" /></span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
