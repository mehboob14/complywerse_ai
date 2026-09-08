'use client';

// Assets Risk Posture — landing (redesign, faithful to risk-posture-handoff mock).
// Self-contained .inv2 styling (inline CSS vars, like the mock + VulnsWorkspace).
// Wired to the REAL dashboard endpoint; every number is computed from live data.
// Honesty rules: unknown signals are excluded (never zeroed); only a re-scan moves
// a score (Recalculate = refetch the live computation); no trend history → "—".

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { riskPostureApi } from '@/lib/api';
import WeightsPanel from '../_weights-panel';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';

const INK = '#0F1F2B', SEC = '#3A4653', MUTED = '#8A95A1', FAINT = '#AEB8C2', BORDER = '#E8ECEE';
const AC = '#17B898', ACSTRONG = '#12A085';

type AssetRow = {
  id: number; name: string; host_name?: string | null; asset_type?: string | null;
  mode?: string | null; criticality?: string | null;
  score: number | null; band: { label: string; description: string };
  data_quality: number; known_dimensions: string[];
  contributions: { cis: number; vuln: number; cia: number; ctrl: number; risk: number };
  cis_pass_rate?: number | null; active_vulns: number | null; total_vulns: number | null;
  cia_known: boolean; control_coverage_pct: number | null; active_risks: number | null; total_risks: number | null;
};
type Dashboard = {
  assets: AssetRow[];
  summary: { asset_count: number; scored_count: number; avg_score: number | null; by_band: Record<string, number>; highest_score: number | null; highest_name?: string | null };
  weights: { cis: number; vuln: number; cia: number; ctrl: number; risk: number };
};

// Real backend bands (contained/watch/elevated/severe) rendered in the mock's palette.
type BandKey = 'severe' | 'elevated' | 'watch' | 'contained' | 'unknown';
const BAND: Record<BandKey, { label: string; bar: string; fg: string; bg: string }> = {
  severe: { label: 'Severe', bar: '#C2453F', fg: '#B23A3A', bg: '#FBEAEA' },
  elevated: { label: 'Elevated', bar: '#DB7B45', fg: '#C0682F', bg: '#FCEEE2' },
  watch: { label: 'Watch', bar: '#E0AF33', fg: '#9A6410', bg: '#FBF2DF' },
  contained: { label: 'Contained', bar: '#17B898', fg: '#1F7A54', bg: '#E7F5EE' },
  unknown: { label: 'Unscored', bar: '#AEB8C2', fg: '#6B7787', bg: '#EEF1F3' },
};
const bandFromScore = (s: number | null): BandKey => s == null ? 'unknown' : s >= 75 ? 'severe' : s >= 50 ? 'elevated' : s >= 25 ? 'watch' : 'contained';
const isExternal = (a: AssetRow) => a.mode === 'easm' || /external|easm/i.test(a.asset_type || '');
const titleCase = (s?: string | null) => (s || '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Top driver = the dimension contributing the most to this asset's score.
const DRIVER_LABEL: Record<string, string> = { vuln: 'Vulnerabilities', cis: 'CIS hardening gap', cia: 'Business-impact value', ctrl: 'Control gap', risk: 'Linked risks', hygiene: 'Exposure hygiene', exploitability: 'Exploitability', exposure: 'Internet exposure', business: 'Business impact' };
function topDriver(a: AssetRow): string {
  const c = a.contributions || ({} as AssetRow['contributions']);
  const entries = Object.entries(c) as [string, number][];
  if (!entries.length) return '—';
  const [k, v] = entries.reduce((m, e) => (e[1] > m[1] ? e : m), ['', -1] as [string, number]);
  if (v <= 0) return 'No dominant driver';
  const ev = k === 'vuln' ? `${a.active_vulns} active vuln${a.active_vulns === 1 ? '' : 's'}`
    : k === 'cis' ? (a.cis_pass_rate != null ? `CIS ${a.cis_pass_rate}% pass` : 'CIS fails')
      : k === 'ctrl' ? `${a.control_coverage_pct}% covered`
        : k === 'risk' ? `${a.active_risks} active risk${a.active_risks === 1 ? '' : 's'}`
          : a.criticality ? `criticality ${a.criticality.toLowerCase()}` : '';
  return (DRIVER_LABEL[k] || titleCase(k)) + (ev ? ` · ${ev}` : '');
}

function Ring({ score, size, col }: { score: number | null; size: number; col: string }) {
  const s = score ?? 0;
  const r = 15.9, c = 2 * Math.PI * r, off = c * (1 - s / 100);
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" style={{ flex: 'none' }}>
      <circle cx="21" cy="21" r={r} fill="none" stroke="#EEF1F4" strokeWidth="4.5" />
      {score != null && <circle cx="21" cy="21" r={r} fill="none" stroke={col} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={c.toFixed(1)} strokeDashoffset={off.toFixed(1)} transform="rotate(-90 21 21)" />}
      <text x="21" y="20.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="#0F1F2B">{score == null ? '—' : Math.round(score)}</text>
      <text x="21" y="27" textAnchor="middle" fontSize="3.2" letterSpacing=".1em" fill="#AEB8C2">RISK /100</text>
    </svg>
  );
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase', color: FAINT, fontWeight: 600, padding: '10px 12px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '11px 12px', borderBottom: '1px solid #F0F3F5', verticalAlign: 'middle', fontSize: 12.5 };
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)' };
const btn: React.CSSProperties = { border: '1px solid #E4E8EC', background: '#fff', color: SEC, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
const btnGreen: React.CSSProperties = { ...btn, background: AC, borderColor: AC, color: '#06342B', fontWeight: 600 };

type TypeF = 'all' | 'int' | 'ext';

export default function RiskPostureWorkspace() {
  const router = useRouter();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const toast = useToast();
  const [typeF, setTypeF] = useState<TypeF>('all');
  const [bandF, setBandF] = useState<BandKey | ''>('');
  const [term, setTerm] = useState('');
  const [weightsOpen, setWeightsOpen] = useState(false);

  const q = useQuery<Dashboard>({ queryKey: ['risk-posture.dashboard'], queryFn: async () => (await riskPostureApi.dashboard()).data, refetchInterval: 30000 });

  const assets = q.data?.assets ?? [];
  const summary = q.data?.summary;

  const derived = useMemo(() => {
    const scored = (rows: AssetRow[]) => rows.filter((a) => a.score != null);
    const avg = (rows: AssetRow[]) => { const s = scored(rows); return s.length ? Math.round(s.reduce((a, r) => a + (r.score || 0), 0) / s.length) : null; };
    const intl = assets.filter((a) => !isExternal(a));
    const extl = assets.filter((a) => isExternal(a));
    return {
      intl, extl, intAvg: avg(intl), extAvg: avg(extl),
      critNotAssessed: assets.filter((a) => !a.criticality || /not assessed/i.test(a.criticality)).length,
      noControls: assets.filter((a) => !isExternal(a) && (a.control_coverage_pct ?? 0) === 0).length,
      openVulns: assets.reduce((s, a) => s + (a.active_vulns || 0), 0),
    };
  }, [assets]);

  const rows = useMemo(() => {
    let r = assets;
    if (typeF !== 'all') r = r.filter((a) => (typeF === 'ext' ? isExternal(a) : !isExternal(a)));
    if (bandF) r = r.filter((a) => a.band.label === bandF);
    if (term.trim()) { const t = term.toLowerCase(); r = r.filter((a) => a.name.toLowerCase().includes(t) || (a.host_name || '').toLowerCase().includes(t) || (a.asset_type || '').toLowerCase().includes(t)); }
    return [...r].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [assets, typeF, bandF, term]);

  if (q.isLoading) return <div style={{ padding: 24, fontSize: 13, color: MUTED }}>Loading risk posture…</div>;
  if (q.isError || !q.data || !summary) return <div style={{ padding: 24, fontSize: 13, color: '#B23A3A' }}>Failed to load risk posture.</div>;

  const total = summary.asset_count;
  const tenantAvg = summary.avg_score;
  const tenantBand = BAND[bandFromScore(tenantAvg)];
  const bandOrder: BandKey[] = ['severe', 'elevated', 'watch', 'contained'];
  const bandTotal = bandOrder.reduce((s, k) => s + (summary.by_band[k] || 0), 0) || 1;

  const Tile = ({ t, label, col }: { t: 'int' | 'ext'; label: string; col: string }) => {
    const list = t === 'int' ? derived.intl : derived.extl;
    const avg = t === 'int' ? derived.intAvg : derived.extAvg;
    const active = typeF === t;
    return (
      <button onClick={() => setTypeF(active ? 'all' : t)} style={{ border: `1px solid ${active ? col : BORDER}`, background: active ? '#F7FBFA' : '#fff', borderRadius: 12, padding: '10px 14px', textAlign: 'left', cursor: 'pointer', minWidth: 128 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: col, fontWeight: 700 }}>{label}</div>
        <b style={{ fontSize: 19, fontVariantNumeric: 'tabular-nums' }}>{list.length}</b>
        <div style={{ fontSize: 10, color: FAINT }}>avg {avg ?? '—'} · {t === 'int' ? 'agent + scanner' : 'EASM'}</div>
      </button>
    );
  };
  const Pill = ({ dot, n, label, onClick }: { dot: string; n: number | string; label: string; onClick?: () => void }) => (
    <button onClick={onClick} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '5px 12px', fontSize: 11.5, fontWeight: 500, background: '#fff', cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none' }} />
      <b style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{n}</b>
      <span style={{ color: '#5B6673' }}>{label}</span>
      <span style={{ color: '#C6CDD4' }}>›</span>
    </button>
  );
  const seg = (id: TypeF, label: string) => (
    <button onClick={() => setTypeF(id)} style={{ height: 32, padding: '0 16px', border: 0, borderRadius: 9, background: typeF === id ? '#fff' : 'none', color: typeF === id ? ACSTRONG : '#6B7787', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: typeF === id ? '0 1px 2px rgba(16,24,40,.06)' : 'none' }}>{label}</button>
  );

  return (
    <div className="inv2" style={{ ['--ac' as string]: AC, ['--ac-strong' as string]: ACSTRONG, background: '#F4F6F7', minHeight: '100%', padding: '4px 2px 40px', fontFamily: 'Poppins, system-ui, "Segoe UI", sans-serif', fontSize: 13.5, color: INK }}>
      <style>{`.rp-row:hover{background:#F7FBFA}`}</style>
      <WeightsPanel open={weightsOpen} onClose={() => setWeightsOpen(false)} />

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: '-.025em', fontWeight: 600 }}>Assets Risk Posture</h1>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: AC }} />
            {total} assets scored on read · risk = weighted blend of vulnerabilities, hardening, control gap and business impact
          </div>
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <button style={btn} onClick={() => { if (!hasPermission('compliance:scan:execute')) { toast.toast({ title: 'Permission required', message: 'Only an administrator or scan operator can change risk weights.', type: 'warning' }); return; } setWeightsOpen(true); }}>Tune weights</button>
          <button style={btnGreen} onClick={() => { qc.invalidateQueries({ queryKey: ['risk-posture.dashboard'] }); toast.toast({ title: 'Recalculating', message: `Re-scoring ${total} assets from live signals.`, type: 'info' }); }}>↻ Recalculate</button>
        </div>
      </div>

      {/* hero */}
      <div style={{ ...card, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>
            <Ring score={tenantAvg} size={96} col={tenantBand.bar} />
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: FAINT, fontWeight: 700 }}>Tenant risk index</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <b style={{ fontSize: 20 }}>{tenantAvg == null ? '—' : tenantBand.label}</b>
                <span style={{ fontSize: 11, fontWeight: 600, color: MUTED, whiteSpace: 'nowrap' }}>{summary.scored_count} of {total} scored</span>
              </div>
              <div style={{ fontSize: 10.5, color: MUTED, maxWidth: 210, marginTop: 3 }}>Mean of all {total} asset scores — recomputed live from each asset&rsquo;s signals on every read.</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: FAINT, fontWeight: 700 }}>Assets by risk band</span>
              <span style={{ fontSize: 10, color: FAINT }}>{bandF ? 'click again to clear' : 'click to filter'}</span>
            </div>
            <div style={{ display: 'flex', height: 22, borderRadius: 8, overflow: 'hidden', marginTop: 8, background: '#F0F3F5' }}>
              {bandOrder.map((k) => { const n = summary.by_band[k] || 0; if (!n) return null; return (
                <span key={k} onClick={() => setBandF(bandF === k ? '' : k)} title={`${BAND[k].label} · ${n} assets`} style={{ width: `${(n / bandTotal) * 100}%`, background: BAND[k].bar, cursor: 'pointer', display: 'grid', placeItems: 'center', minWidth: 26, outline: bandF === k ? '2px solid #0F1F2B' : 'none', outlineOffset: -2, zIndex: bandF === k ? 1 : 0 }}>
                  <b style={{ fontSize: 10, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{n}</b>
                </span>); })}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 7, flexWrap: 'wrap', fontSize: 10.5, color: MUTED }}>
              {bandOrder.map((k) => (<span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: BAND[k].bar }} />{BAND[k].label}</span>))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flex: 'none' }}>
            <Tile t="int" label="Internal" col="#2E63A8" />
            <Tile t="ext" label="External" col="#6A54C9" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'nowrap', overflowX: 'auto', padding: '11px 22px', background: '#FAFBFC', borderTop: '1px solid #F0F3F5' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: FAINT, fontWeight: 700, flex: 'none' }}>Driving the index</span>
          <Pill dot="#9A6410" n={derived.critNotAssessed} label="criticality not assessed" />
          <Pill dot="#8A95A1" n={derived.noControls} label="no controls mapped" />
          <Pill dot="#C0682F" n={derived.openVulns} label="active vulns across assets" onClick={() => router.push('/vulnerabilities')} />
          {summary.by_band.unknown ? <Pill dot="#AEB8C2" n={summary.by_band.unknown} label="not yet scored" /> : null}
          {summary.highest_name ? <Pill dot="#C2453F" n={summary.highest_score ?? 0} label={`highest · ${summary.highest_name}`} /> : null}
        </div>
      </div>

      {/* tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', background: '#EAEEF1', borderRadius: 11, padding: 3, gap: 2 }}>
          {seg('all', `All ${total}`)}{seg('int', `Internal ${derived.intl.length}`)}{seg('ext', `External ${derived.extl.length}`)}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <SearchIcon style={{ position: 'absolute', left: 10, top: 9, width: 16, height: 16, color: FAINT }} />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search assets…" style={{ width: '100%', height: 36, border: '1px solid #E4E8EC', borderRadius: 10, background: '#fff', padding: '0 12px 0 32px', fontSize: 12 }} />
        </div>
        {bandF ? <button style={{ ...btn, padding: '5px 10px', fontSize: 11.5 }} onClick={() => setBandF('')}>Band: {BAND[bandF].label} ✕</button> : null}
      </div>

      {/* table */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
            <thead>
              <tr>
                <th style={th}>Asset</th><th style={th}>Type</th><th style={th}>Criticality</th><th style={th}>Risk score</th>
                <th style={th}>Band</th><th style={th}>Top driver</th><th style={th}>Vulns</th><th style={th}>Benchmark</th><th style={th}>30d</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (<tr><td style={{ ...td, textAlign: 'center', color: MUTED, padding: 22 }} colSpan={9}>No assets match.</td></tr>)}
              {rows.map((a) => {
                const b = BAND[(a.band.label as BandKey) in BAND ? (a.band.label as BandKey) : bandFromScore(a.score)];
                const ext = isExternal(a);
                const sub = [titleCase(a.asset_type), a.host_name].filter(Boolean).join(' · ');
                return (
                  <tr key={a.id} className="rp-row" style={{ cursor: 'pointer' }} onClick={() => router.push(`/risk-posture/asset/${a.id}`)}>
                    <td style={td}><b style={{ fontSize: 12.5 }}>{a.name}</b><div style={{ fontSize: 10.5, color: FAINT }}>{sub || '—'}</div></td>
                    <td style={td}><span style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 5, letterSpacing: '.03em', background: ext ? '#EEEBFA' : '#E9F1FB', color: ext ? '#6A54C9' : '#2E63A8' }}>{ext ? 'EXTERNAL' : 'INTERNAL'}</span></td>
                    <td style={{ ...td, color: !a.criticality || /not assessed/i.test(a.criticality) ? FAINT : SEC }}>{a.criticality ? titleCase(a.criticality) : 'Not assessed'}</td>
                    <td style={td}>
                      {a.score == null ? <span style={{ fontSize: 11.5, color: FAINT, fontStyle: 'italic' }}>No data</span> : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 130 }}>
                          <span style={{ flex: 1, height: 7, borderRadius: 99, background: '#F0F3F5', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${a.score}%`, background: b.bar, borderRadius: 99 }} /></span>
                          <b style={{ fontSize: 12.5, color: b.bar, fontVariantNumeric: 'tabular-nums' }}>{a.score}</b>
                        </div>
                      )}
                    </td>
                    <td style={td}><span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', padding: '1px 7px', borderRadius: 5, background: b.bg, color: b.fg }}>{b.label}</span></td>
                    <td style={{ ...td, fontSize: 11.5, color: '#5B6673', maxWidth: 240 }}>{topDriver(a)}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{a.active_vulns == null ? <span style={{ color: FAINT }}>—</span> : <>{a.active_vulns}{(a.total_vulns ?? 0) > a.active_vulns ? <span style={{ color: FAINT, fontSize: 10.5 }}> /{a.total_vulns}</span> : null}</>}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: MUTED }}>{a.cis_pass_rate == null ? '—' : `CIS ${a.cis_pass_rate}%`}</td>
                    <td style={{ ...td, color: FAINT }}>—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 11, color: MUTED }}>Row → full posture breakdown · {rows.length} of {total} shown · 30-day trend not yet tracked (shown as —).</div>
      </div>
    </div>
  );
}
