'use client';

// Assets Risk Posture — DETAIL (redesign, faithful to the risk-posture-handoff mock).
// Re-skins the mock's detailShell + renderInt/renderExt over the PROVEN real
// wiring from asset/[id]/page.tsx: same query keys, same preview/save mutations,
// same field names. Nothing about the data layer is reinvented here.
//
// Honesty rules enforced (see task invariants):
//  · Only KNOWN dimensions are drawn as weighted bars from real components/
//    contributions/weights; unknown dimensions are MUTED ("excluded"), never 0.
//  · The real internal model has 5 dims (vuln .30 / cis .25 / cia .15 / ctrl .15 /
//    risk .15) — NOT the mock's 6. There is no "Patch & endpoint" dimension.
//  · A human edit / mapped control never lowers the score — only a re-scan does.
//    "Recalculate" = invalidate + refetch (scores compute live on GET); there is
//    no recalculate endpoint. External "Re-probe" has no endpoint → honest toast.
//  · CIA is edited only in the modal; Save re-scores server-side.
//  · No trend history exists → the header sparkline is flat and the trend is "—".
//  · Signals the API doesn't return (EDR / BitLocker / Firewall / last-scan /
//    open-ports) are omitted, not faked.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X, RefreshCw, Sparkles, ExternalLink, SlidersHorizontal } from 'lucide-react';
import { assetsApi, riskPostureApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';

// ── shared design tokens (copied from RiskPostureWorkspace so the landing stays untouched) ──
const INK = '#0F1F2B', SEC = '#3A4653', MUTED = '#8A95A1', FAINT = '#AEB8C2', BORDER = '#E8ECEE';
const AC = '#17B898', ACSTRONG = '#12A085';

type BandKey = 'severe' | 'elevated' | 'watch' | 'contained' | 'unknown';
const BAND: Record<BandKey, { label: string; bar: string; fg: string; bg: string }> = {
  severe: { label: 'Severe', bar: '#C2453F', fg: '#B23A3A', bg: '#FBEAEA' },
  elevated: { label: 'Elevated', bar: '#DB7B45', fg: '#C0682F', bg: '#FCEEE2' },
  watch: { label: 'Watch', bar: '#E0AF33', fg: '#9A6410', bg: '#FBF2DF' },
  contained: { label: 'Contained', bar: '#17B898', fg: '#1F7A54', bg: '#E7F5EE' },
  unknown: { label: 'Unscored', bar: '#AEB8C2', fg: '#6B7787', bg: '#EEF1F3' },
};
const bandFromScore = (s: number | null): BandKey => s == null ? 'unknown' : s >= 75 ? 'severe' : s >= 50 ? 'elevated' : s >= 25 ? 'watch' : 'contained';
const bandOf = (label: string | undefined, score: number | null): BandKey =>
  (label && (label.toLowerCase() as BandKey) in BAND) ? (label.toLowerCase() as BandKey) : bandFromScore(score);
const titleCase = (s?: string | null) => (s || '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const sevCol = (pct: number) => pct >= 75 ? '#C2453F' : pct >= 50 ? '#DB7B45' : pct >= 25 ? '#E0AF33' : '#17B898';

const card: CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)' };
const btn: CSSProperties = { border: '1px solid #E4E8EC', background: '#fff', color: SEC, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', textDecoration: 'none' };
const btnSm: CSSProperties = { ...btn, padding: '5px 10px', fontSize: 11.5 };
const btnGreen: CSSProperties = { ...btn, background: AC, borderColor: AC, color: '#06342B', fontWeight: 600 };
const lnkStyle: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: ACSTRONG, whiteSpace: 'nowrap', textDecoration: 'none' };
const lnkBtn: CSSProperties = { border: 0, background: 'none', padding: 0, fontSize: 10.5, fontWeight: 600, color: ACSTRONG, whiteSpace: 'nowrap', cursor: 'pointer' };

// ── types (the shapes we actually read; matches asset/[id]/page.tsx) ──
type PerVuln = {
  vuln_id: number; cve_id?: string | null; title?: string | null; severity?: string | null;
  cvss_score?: number | null; epss_score?: number | null; kev_flag?: boolean; score: number; band: string;
};
type Internal = {
  mode?: undefined;
  asset: { id: number; name: string; host_name?: string | null; ip_address?: string | null; asset_type?: string | null; criticality?: string | null; owner_name?: string | null };
  score: number | null;
  band: { label: string; description?: string };
  weights: Record<'cis' | 'vuln' | 'cia' | 'ctrl' | 'risk', number>;
  data_quality: number;
  known_dimensions: string[];
  components: {
    cis: { score: number; known: boolean; passed: number; failed: number; total: number; pass_rate: number | null; errored?: number; never_scanned?: number };
    vuln: { score: number; known: boolean; active_count: number; total_linked: number; by_severity: Record<string, number>; raw_points?: number; effective_risk?: { per_vuln: PerVuln[] } };
    cia: { score: number; known: boolean; confidentiality: number | null; integrity: number | null; availability: number | null; missing: boolean; auto_derived?: boolean };
    ctrl: { score: number; known: boolean; coverage_pct: number; linked_count: number; target: number };
    risk: { score: number; known: boolean; active_count: number; total_linked: number };
  };
  contributions: Record<'cis' | 'vuln' | 'cia' | 'ctrl' | 'risk', number>;
};
// External is read loosely — same pragmatic `any` posture as EasmRiskView.
type Easm = { mode: 'easm'; asset: any; score: number | null; band: { label: string; description?: string }; components: Record<string, any>; contributions: Record<string, number>; health?: any; probe?: any; data_quality?: number };
type Posture = Internal | Easm;
const isEasm = (d: Posture): d is Easm => (d as Easm).mode === 'easm';

type AssetForBiz = {
  id: number; name: string; criticality?: string;
  confidentiality_rating?: number | null; integrity_rating?: number | null; availability_rating?: number | null;
  is_customer_facing?: boolean; is_internet_facing?: boolean;
  regulated_data_type?: string; operational_dependency?: string; business_impact_notes?: string | null;
};
type PreviewResp = { before: { score: number; band: { label: string } }; after: { score: number; band: { label: string } }; delta: number };

const CRIT_TO_CIA = (c?: string): number => {
  switch ((c || '').toLowerCase()) { case 'critical': return 5; case 'high': return 4; case 'low': return 2; default: return 3; }
};

// ── tiny visual helpers ported 1:1 from the mock ──
function Ring({ score, size, col }: { score: number; size: number; col: string }) {
  const r = 15.9, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" style={{ flex: 'none' }}>
      <circle cx="21" cy="21" r={r} fill="none" stroke="#EEF1F4" strokeWidth="4.5" />
      <circle cx="21" cy="21" r={r} fill="none" stroke={col} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={c.toFixed(1)} strokeDashoffset={off.toFixed(1)} transform="rotate(-90 21 21)" />
      <text x="21" y="20.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="#0F1F2B">{score}</text>
      <text x="21" y="27" textAnchor="middle" fontSize="3.2" letterSpacing=".1em" fill="#AEB8C2">RISK /100</text>
    </svg>
  );
}
// Flat, deliberately — no 90-day history exists to plot, and inventing one is forbidden.
function FlatSpark({ col }: { col: string }) {
  const w = 150, h = 36, y = h / 2;
  return (
    <svg width={w} height={h} style={{ flex: 'none' }}>
      <line x1={4} y1={y} x2={w - 4} y2={y} stroke={col} strokeWidth={2} strokeLinecap="round" opacity={0.45} />
      <circle cx={w - 4} cy={y} r={3} fill={col} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}
function Card({ title, sub, grow, children }: { title: string; sub?: string; grow?: boolean; children: ReactNode }) {
  return (
    <div style={{ ...card, padding: '11px 14px', marginBottom: 10, ...(grow ? { display: 'flex', flexDirection: 'column' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12.5, flex: 'none', whiteSpace: 'nowrap' }}>{title}</b>
        {sub ? <span style={{ fontSize: 10.5, color: MUTED, minWidth: 0 }}>{sub}</span> : null}
      </div>
      <div style={{ marginTop: 7, ...(grow ? { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } : {}) }}>{children}</div>
    </div>
  );
}
function Hbar({ label, sub, pct, pts, ev, col, link }: { label: string; sub: string; pct: number; pts: number; ev: string; col: string; link?: ReactNode }) {
  const w = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid #F4F6F7' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: '0 0 150px', minWidth: 0 }}>
          <span style={{ fontSize: 12, color: SEC, fontWeight: 500, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          <span style={{ fontSize: 9.5, color: FAINT, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
        </span>
        <span style={{ flex: 1, minWidth: 56, height: 8, borderRadius: 99, background: '#F0F3F5', overflow: 'hidden', display: 'block' }}>
          <i style={{ display: 'block', height: '100%', width: `${w}%`, background: col, borderRadius: 99 }} />
        </span>
        <b className="mono" style={{ flex: '0 0 52px', textAlign: 'right', fontSize: 12, color: pts > 0 ? INK : FAINT }}>+{pts}<span style={{ fontWeight: 400, fontSize: 9.5, color: FAINT }}> pts</span></b>
        {link ? <span style={{ flex: '0 0 84px', textAlign: 'right', whiteSpace: 'nowrap' }}>{link}</span> : null}
      </div>
      {ev ? <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3, paddingLeft: 162 }}>{ev}</div> : null}
    </div>
  );
}
function MutedRow({ label, weight, note, link }: { label: string; weight: string; note: string; link?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid #F4F6F7', flexWrap: 'wrap' }}>
      <span style={{ flex: '0 0 168px', minWidth: 0, opacity: 0.6 }}>
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 500, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <span style={{ fontSize: 10, color: FAINT, display: 'block' }}>{weight} · muted</span>
      </span>
      <span style={{ flex: '1 1 70px', minWidth: 56, height: 8, borderRadius: 99, background: '#F0F3F5', display: 'block', opacity: 0.6 }} />
      <span style={{ flex: '0 0 158px', fontSize: 10.5, color: FAINT, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</span>
      <b style={{ flex: '0 0 52px' }} />
      {link ? <span style={{ flex: '0 0 92px', textAlign: 'right', whiteSpace: 'nowrap' }}>{link}</span> : null}
    </div>
  );
}
function Kv({ k, v, c }: { k: string; v: ReactNode; c?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #F6F7F9' }}>
      <span style={{ color: MUTED, flex: 'none' }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', color: c || SEC }}>{v}</span>
    </div>
  );
}
function Chip({ t, warn }: { t: string; warn?: boolean }) {
  return <span className="mono" style={{ display: 'inline-block', border: `1px solid ${warn ? '#EAD9AE' : '#E4E8EC'}`, background: warn ? '#FFFDF5' : '#F7F9FA', color: warn ? '#9A6410' : '#5B6673', borderRadius: 7, padding: '2px 9px', fontSize: 10.5, fontWeight: 600, margin: '3px 4px 0 0' }}>{t}</span>;
}
function ContribRow({ dot, title, meta, href }: { dot: string; title: ReactNode; meta: string; href?: string }) {
  const s: CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, borderBottom: '1px solid #F4F6F7', padding: '6px 0', textDecoration: 'none', color: INK };
  const inner = (
    <>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none' }} />
      <b style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
      <span style={{ fontSize: 10.5, color: MUTED, flex: 'none' }}>{meta}</span>
      {href ? <span style={{ color: '#B4BDC6' }}>›</span> : null}
    </>
  );
  return href ? <Link href={href} style={s}>{inner}</Link> : <div style={s}>{inner}</div>;
}

// ── type + band badges shared by both shells ──
function TypeBadge({ ext }: { ext: boolean }) {
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 5, letterSpacing: '.03em', background: ext ? '#EEEBFA' : '#E9F1FB', color: ext ? '#6A54C9' : '#2E63A8' }}>{ext ? 'EXTERNAL · OUTSIDE-IN' : 'INTERNAL'}</span>;
}
function BandPill({ b }: { b: { label: string; fg: string; bg: string } }) {
  return <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', padding: '1px 7px', borderRadius: 5, background: b.bg, color: b.fg }}>{b.label} risk</span>;
}

export default function AssetPostureDetail({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false); // CIA modal (internal only)

  const postureQ = useQuery<Posture>({
    queryKey: ['risk-posture.asset', assetId],
    queryFn: async () => (await riskPostureApi.asset(assetId)).data as Posture,
    enabled: assetId > 0,
  });
  const assetQ = useQuery<AssetForBiz>({
    queryKey: ['asset-detail', assetId],
    queryFn: async () => (await assetsApi.getDetail(assetId)).data as AssetForBiz,
    enabled: assetId > 0,
  });

  // Business-context editable state — hydrated from assetQ, exactly as the old page.
  const defaultCIA = CRIT_TO_CIA(assetQ.data?.criticality);
  const [form, setForm] = useState({
    is_customer_facing: false, is_internet_facing: false,
    regulated_data_type: 'none', operational_dependency: 'medium',
    confidentiality_rating: 3, integrity_rating: 3, availability_rating: 3,
    business_impact_notes: '',
  });
  const hydrateForm = useCallback(() => {
    const a = assetQ.data;
    if (!a) return;
    setForm({
      is_customer_facing: a.is_customer_facing ?? false,
      is_internet_facing: a.is_internet_facing ?? false,
      regulated_data_type: a.regulated_data_type || 'none',
      operational_dependency: a.operational_dependency || 'medium',
      confidentiality_rating: a.confidentiality_rating ?? defaultCIA,
      integrity_rating: a.integrity_rating ?? defaultCIA,
      availability_rating: a.availability_rating ?? defaultCIA,
      business_impact_notes: a.business_impact_notes ?? '',
    });
  }, [assetQ.data, defaultCIA]);
  // Depend on the values themselves so a save re-hydrates (the old id-only dep
  // let stale defaults clobber untouched fields — see the original comment).
  useEffect(() => { hydrateForm(); }, [
    assetQ.data?.id, assetQ.data?.is_customer_facing, assetQ.data?.is_internet_facing,
    assetQ.data?.regulated_data_type, assetQ.data?.operational_dependency,
    assetQ.data?.confidentiality_rating, assetQ.data?.integrity_rating, assetQ.data?.availability_rating,
    assetQ.data?.business_impact_notes, defaultCIA, hydrateForm,
  ]);

  const isDirty = useMemo(() => {
    const a = assetQ.data; if (!a) return false;
    return (
      form.is_customer_facing !== (a.is_customer_facing ?? false) ||
      form.is_internet_facing !== (a.is_internet_facing ?? false) ||
      form.regulated_data_type !== (a.regulated_data_type || 'none') ||
      form.operational_dependency !== (a.operational_dependency || 'medium') ||
      form.confidentiality_rating !== (a.confidentiality_rating ?? defaultCIA) ||
      form.integrity_rating !== (a.integrity_rating ?? defaultCIA) ||
      form.availability_rating !== (a.availability_rating ?? defaultCIA) ||
      (form.business_impact_notes || '') !== (a.business_impact_notes || '')
    );
  }, [assetQ.data, form, defaultCIA]);

  // Live preview — send the same 4 business-context fields the old page sent.
  // (CIA ratings are not part of the preview endpoint's contract; they re-score
  // on Save. The modal says so.)
  const previewQ = useQuery<PreviewResp>({
    queryKey: ['risk-preview', assetId, form.is_customer_facing, form.is_internet_facing, form.regulated_data_type, form.operational_dependency],
    queryFn: async () => (await riskPostureApi.previewAsset(assetId, {
      is_customer_facing: form.is_customer_facing,
      is_internet_facing: form.is_internet_facing,
      regulated_data_type: form.regulated_data_type,
      operational_dependency: form.operational_dependency,
    })).data as PreviewResp,
    enabled: isDirty && assetId > 0,
    staleTime: 0,
  });

  const saveMut = useMutation({
    mutationFn: () => assetsApi.update(assetId, {
      is_customer_facing: form.is_customer_facing,
      is_internet_facing: form.is_internet_facing,
      regulated_data_type: form.regulated_data_type,
      operational_dependency: form.operational_dependency,
      confidentiality_rating: form.confidentiality_rating,
      integrity_rating: form.integrity_rating,
      availability_rating: form.availability_rating,
      business_impact_notes: form.business_impact_notes || null,
    } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      qc.invalidateQueries({ queryKey: ['risk-posture.asset', assetId] });
      qc.invalidateQueries({ queryKey: ['risk-posture.dashboard'] });
      setOpen(false);
      toast.toast({ title: 'Saved', message: 'Criticality re-derived from CIA · risk re-scored on read.', type: 'success' });
    },
    onError: () => toast.toast({ title: 'Save failed', message: 'Could not persist scoring inputs.', type: 'error' }),
  });

  // A human edit / mapped control never lowers a score — only a re-scan does.
  // There is no recalculate endpoint; scores compute live on GET, so this just
  // invalidates + refetches.
  const recalc = () => {
    qc.invalidateQueries({ queryKey: ['risk-posture.asset', assetId] });
    qc.invalidateQueries({ queryKey: ['risk-posture.dashboard'] });
    postureQ.refetch();
    toast.toast({ title: 'Recalculating', message: 'Re-scoring this asset from live signals.', type: 'info' });
  };
  const reprobe = () => toast.toast({ title: 'Re-probe queued', message: 'External assets are re-scored on the next EASM discovery sweep — there is no on-demand probe.', type: 'info' });

  if (postureQ.isLoading || (assetId > 0 && assetQ.isLoading && !postureQ.data)) {
    return <div style={{ padding: 24, fontSize: 13, color: MUTED }}>Loading risk breakdown…</div>;
  }
  if (postureQ.isError || !postureQ.data) {
    return (
      <div style={{ padding: 16, fontFamily: 'Poppins, system-ui, sans-serif' }}>
        <Link href="/risk-posture" style={btnSm}><ArrowLeft size={14} /> All assets</Link>
        <div style={{ marginTop: 16, fontSize: 13, color: '#B23A3A' }}>Failed to load asset.</div>
      </div>
    );
  }

  const data = postureQ.data;
  const external = isEasm(data);
  const b = BAND[bandOf(data.band?.label, data.score)];

  const root: CSSProperties = { ['--ac' as string]: AC, ['--ac-strong' as string]: ACSTRONG, background: '#F4F6F7', minHeight: '100%', padding: '4px 2px 40px', fontFamily: 'Poppins, system-ui, "Segoe UI", sans-serif', fontSize: 13.5, color: INK } as CSSProperties;

  // ── shared header shell ──
  const shell = (extraPill: ReactNode, hostLine: string, subLine: string, actions: ReactNode) => (
    <>
      <Link href="/risk-posture" style={{ ...btnSm, marginBottom: 10 }}><ArrowLeft size={14} /> All assets</Link>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 16px', marginBottom: 12 }}>
        <Ring score={data.score ?? 0} size={66} col={b.bar} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.015em' }}>{data.asset?.name}</h1>
            <TypeBadge ext={external} />
            <BandPill b={b} />
            {extraPill}
          </div>
          <div className="mono" style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{hostLine || '—'}</div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{subLine}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: FAINT }}>90-day trend</span>
            <FlatSpark col={b.bar} />
            <span style={{ fontSize: 11, color: FAINT }}>— not tracked</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{actions}</div>
      </div>
    </>
  );

  // ══════════════ EXTERNAL (EASM, outside-in) ══════════════
  if (external) {
    const d = data;
    const probe = d.probe || {};
    const comps = (Object.entries(d.components || {}) as [string, any][]).sort((a, c) => (c[1].weight || 0) - (a[1].weight || 0));
    const effW = comps.reduce((s, [, c]) => s + (c.weight || 0), 0) || 1;
    const grade = d.health?.grade ?? '—';
    const hScore = d.health?.score ?? '—';
    const host = [d.asset?.fqdn || d.asset?.host_name, d.asset?.ip_address].filter(Boolean).join(' · ');

    // Contributors derived from real probe fields only (no fabricated findings).
    type C = { title: string; meta: string; col: string };
    const contribs: C[] = [];
    if (probe.tls_expired) contribs.push({ title: 'TLS certificate expired', meta: 'renew immediately', col: '#C2453F' });
    else if (probe.tls_days_to_expiry != null && probe.tls_days_to_expiry <= 30) contribs.push({ title: `Certificate expires in ${probe.tls_days_to_expiry} days`, meta: 'availability + trust risk', col: '#C2453F' });
    if ((probe.kev_count ?? 0) > 0) contribs.push({ title: `${probe.kev_count} KEV finding${probe.kev_count === 1 ? '' : 's'} on exposed service`, meta: 'actively exploited', col: '#C2453F' });
    else if ((probe.cve_count ?? 0) > 0) contribs.push({ title: `${probe.cve_count} known CVE${probe.cve_count === 1 ? '' : 's'} on exposed service`, meta: 'patch the surface', col: '#C0682F' });
    if (probe.https_available === false) contribs.push({ title: 'No HTTPS on the public endpoint', meta: 'transport not encrypted', col: '#C0682F' });
    if (probe.spf === false || probe.spf === 'missing') contribs.push({ title: 'SPF record missing', meta: 'email spoofing risk', col: '#DB7B45' });
    if (!probe.dmarc || probe.dmarc === 'none' || probe.dmarc === 'p=none') contribs.push({ title: 'DMARC not enforced', meta: probe.dmarc ? `${probe.dmarc}` : 'no record', col: '#E0AF33' });

    // Exposed-surface chips from real DNS/transport/email fields (no open-port list — the probe doesn't collect one).
    const surface: Array<[string, string, boolean]> = [];
    if (probe.tls_not_after) surface.push(['Cert expiry', `${String(probe.tls_not_after).slice(0, 10)}${probe.tls_days_to_expiry != null ? ` · ${probe.tls_days_to_expiry}d` : ''}`, !!probe.tls_expired || (probe.tls_days_to_expiry ?? 99) <= 30]);
    surface.push(['HTTPS', probe.https_available ? 'available' : 'not available', probe.https_available === false]);
    surface.push(['SPF', (probe.spf === false || probe.spf === 'missing') ? 'missing' : 'present', probe.spf === false || probe.spf === 'missing']);
    surface.push(['DMARC', probe.dmarc || 'none', !probe.dmarc || probe.dmarc === 'none' || probe.dmarc === 'p=none']);
    surface.push(['DKIM', (probe.dkim === false || probe.dkim === 'missing') ? 'missing' : 'present', probe.dkim === false || probe.dkim === 'missing']);
    if (probe.cdn_waf) surface.push(['CDN/WAF', String(probe.cdn_waf), false]);
    surface.push(['Security headers', `${Object.keys(probe.security_headers || {}).length}/6`, Object.keys(probe.security_headers || {}).length < 4]);

    const extraPill = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: '#FBF2DF', color: '#9A6410' }}>Health {grade} · {hScore}/100</span>;
    const subLine = `${titleCase(d.asset?.asset_type) || 'External asset'} · criticality ${(d.asset?.criticality || 'not set')} · scored on read · signals from EASM domain discovery`;

    return (
      <div className="inv2" style={root}>
        <style>{`.mono{font-variant-numeric:tabular-nums}`}</style>
        {shell(extraPill, host, subLine, (
          <>
            <Link href={`/assets/${d.asset?.id}`} style={btnSm}>Open asset record <ExternalLink size={13} /></Link>
            <button style={btnSm} onClick={reprobe}><RefreshCw size={13} /> Re-probe</button>
          </>
        ))}

        <div style={{ border: '1px solid #EAD9AE', background: '#FEFBF4', borderRadius: 11, padding: '11px 15px', fontSize: 12, color: '#7A6427', marginBottom: 12 }}>
          This is an <b>externally-discovered</b> asset — scored on outside-in exposure hygiene (TLS, security headers, transport, email auth, known vulnerabilities), <b>not</b> CIA / CIS / control coverage, which can&apos;t be measured on an asset you only see from the internet.
        </div>

        <Card title="Why this score" sub={`weighted outside-in signals · total ${data.score ?? '—'}/100 · bar = signal severity, number = points added`} grow>
          {comps.length === 0 ? (
            <div style={{ fontSize: 12, color: MUTED }}>{d.health?.reason || 'Not probed yet — run an external discovery sweep to grade exposure.'}</div>
          ) : comps.map(([k, c]) => {
            const pct = Math.round((c.score ?? 0) * 100);
            const link = k === 'exploitability' ? <Link href="/vulnerabilities" style={lnkStyle}>Findings →</Link>
              : k === 'business' ? <button style={lnkBtn} onClick={() => toast.toast({ title: 'Criticality', message: 'Criticality is set on the asset record.', type: 'info' })}>Record →</button>
                : undefined;
            return <Hbar key={k} label={c.label || titleCase(k)} sub={`${Math.round((c.weight / effW) * 100)}% of live weight`} pct={pct} pts={d.contributions?.[k] ?? 0} col={sevCol(pct)} ev={c.detail || (c.known ? '' : 'not observed')} link={link} />;
          })}
          <div style={{ fontSize: 10, color: FAINT, marginTop: 8 }}>Observed from outside via EASM — no agent on this asset. Unknown signals are excluded, never zeroed.</div>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 12, alignItems: 'stretch' }}>
          <Card title="Top contributors" sub="fix these to shrink the external surface" grow>
            {contribs.length === 0 ? (
              <div style={{ fontSize: 11.5, color: MUTED }}>No outside-in contributors flagged — exposure hygiene looks clean on the last sweep.</div>
            ) : contribs.slice(0, 4).map((x, i) => <ContribRow key={i} dot={x.col} title={x.title} meta={x.meta} />)}
            <div style={{ fontSize: 10, color: FAINT, marginTop: 'auto', paddingTop: 8 }}>Verified by the next EASM sweep — the sweep is this asset&apos;s re-scan.</div>
          </Card>

          <Card title="Outside-in probe" sub={probe.probed_at ? `last sweep · ${String(probe.probed_at).slice(0, 10)}` : 'not yet probed'} grow>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
              <Kv k="Server" v={probe.server || '—'} c={probe.server ? '#C0682F' : undefined} />
              <Kv k="Response" v={probe.response_time_ms != null ? `${probe.response_time_ms} ms` : '—'} />
              <Kv k="Cert expiry" v={probe.tls_not_after ? `${String(probe.tls_not_after).slice(0, 10)}${probe.tls_days_to_expiry != null ? ` · ${probe.tls_days_to_expiry}d` : ''}` : '—'} c={probe.tls_expired || (probe.tls_days_to_expiry ?? 99) <= 30 ? '#B23A3A' : undefined} />
              <Kv k="Security headers" v={`${Object.keys(probe.security_headers || {}).length} of 6`} />
              <Kv k="Email auth" v={`SPF ${(probe.spf === false || probe.spf === 'missing') ? 'missing' : 'ok'} · DMARC ${probe.dmarc || 'none'}`} c={(probe.spf === false || probe.spf === 'missing') ? '#B23A3A' : undefined} />
              <Kv k="Known CVEs" v={`${probe.cve_count ?? 0}${(probe.kev_count ?? 0) > 0 ? ` · ${probe.kev_count} KEV` : ''}`} c={(probe.kev_count ?? 0) > 0 ? '#B23A3A' : undefined} />
              <Kv k="Health grade" v={`${grade} · ${hScore}/100`} c="#9A6410" />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Link href="/vulnerabilities" style={lnkStyle}>Exposed-service findings →</Link>
              <button style={{ ...lnkBtn, marginLeft: 'auto' }} onClick={reprobe}>↻ Re-probe</button>
            </div>
          </Card>

          <Card title="Exposed surface" sub="DNS, transport & email the internet can see">
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: FAINT, fontWeight: 700, marginBottom: 4 }}>Certificates, transport & email auth</div>
            {surface.map(([k, v, warn], i) => <Chip key={i} t={`${k} · ${v}`} warn={warn} />)}
            <div style={{ fontSize: 10, color: FAINT, marginTop: 10 }}>Open-port enumeration isn&apos;t part of this probe, so no ports/services list is shown.</div>
          </Card>
        </div>
      </div>
    );
  }

  // ══════════════ INTERNAL ══════════════
  const d = data;
  const asset = d.asset;
  const comp = d.components;
  const per = comp.vuln.effective_risk?.per_vuln ?? [];
  const kev = per.filter((v) => v.kev_flag).length;
  const known = (k: keyof Internal['components']) => comp[k].known;
  const effWeight = (['vuln', 'cis', 'cia', 'ctrl', 'risk'] as const).reduce((s, k) => s + (known(k) ? d.weights[k] : 0), 0) || 1;
  const effPct = (k: 'vuln' | 'cis' | 'cia' | 'ctrl' | 'risk') => Math.round((d.weights[k] / effWeight) * 100);

  const DIMS: { key: 'vuln' | 'cis' | 'cia' | 'ctrl' | 'risk'; label: string; desc: string }[] = [
    { key: 'vuln', label: 'Vulnerabilities', desc: 'severity-weighted findings' },
    { key: 'cis', label: 'CIS hardening gap', desc: 'benchmark fails' },
    { key: 'cia', label: 'Business-impact value', desc: 'declared CIA ratings' },
    { key: 'ctrl', label: 'Control gap', desc: 'uncovered controls' },
    { key: 'risk', label: 'Linked risks', desc: 'risk register' },
  ];
  const evidence = (k: 'vuln' | 'cis' | 'cia' | 'ctrl' | 'risk'): string => {
    switch (k) {
      case 'vuln': return `${comp.vuln.active_count} active${comp.vuln.total_linked > comp.vuln.active_count ? ` of ${comp.vuln.total_linked}` : ''} · ${comp.vuln.by_severity?.critical ?? 0} crit / ${comp.vuln.by_severity?.high ?? 0} high / ${comp.vuln.by_severity?.medium ?? 0} med${kev ? ` · ${kev} KEV` : ''}${comp.vuln.raw_points != null ? ` · ${comp.vuln.raw_points} severity-weighted pts` : ''}`;
      case 'cis': return comp.cis.total === 0 ? 'no CIS rules in the library yet' : comp.cis.pass_rate != null ? `${Math.round((comp.cis.passed / comp.cis.total) * 100)}% pass · ${comp.cis.passed}/${comp.cis.total} rules · ${comp.cis.failed} fail${comp.cis.errored ? ` · ${comp.cis.errored} errored` : ''}${comp.cis.never_scanned ? ` · ${comp.cis.never_scanned} never-scanned` : ''}` : 'not scanned yet';
      case 'cia': return comp.cia.auto_derived ? 'auto · derived Medium from criticality (unconfirmed) — set explicit C/I/A to confirm' : `C${comp.cia.confidentiality ?? '–'} · I${comp.cia.integrity ?? '–'} · A${comp.cia.availability ?? '–'} · criticality ${asset.criticality || '—'}`;
      case 'ctrl': return `${comp.ctrl.coverage_pct}% covered · ${comp.ctrl.linked_count} of ${comp.ctrl.target} controls linked`;
      case 'risk': return `${comp.risk.active_count} active${comp.risk.total_linked > comp.risk.active_count ? ` of ${comp.risk.total_linked} linked` : ''}`;
    }
  };
  const dimLink = (k: 'vuln' | 'cis' | 'cia' | 'ctrl' | 'risk', muted: boolean): ReactNode => {
    switch (k) {
      case 'vuln': return <Link href={`/assets/${asset.id}?tab=vulnerabilities`} style={lnkStyle}>Findings →</Link>;
      case 'cis': return <Link href={`/compliance-plugins/asset/${asset.id}`} style={lnkStyle}>CIS →</Link>;
      case 'cia': return <button style={lnkBtn} onClick={() => setOpen(true)}>{muted ? 'Set ratings →' : 'Edit →'}</button>;
      case 'ctrl': return <Link href={`/assets/${asset.id}`} style={lnkStyle}>Link →</Link>;
      case 'risk': return <button style={lnkBtn} onClick={() => toast.toast({ title: 'Risk register', message: 'Open the risk register to link risks to this asset.', type: 'info' })}>Risks →</button>;
    }
  };

  const topContrib = [...per].sort((a, c) => c.score - a.score).slice(0, 4);
  const extraPill = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: '#EEF1F3', color: '#6B7787' }}>Data quality · {d.known_dimensions.length} of 5 signals</span>;
  const subLine = `${titleCase(asset.asset_type) || 'Asset'} · criticality ${asset.criticality || 'not assessed'} · scored on read · signals from agent + Nessus scan`;
  const host = [asset.host_name, asset.ip_address].filter(Boolean).join(' · ');

  // CIA / context tap-picker buckets ↔ real backend fields. Re-selecting the
  // current bucket is a no-op, so an existing granular value (rating 4, PCI,
  // op-dep critical) is preserved rather than flattened by the 3-way picker.
  const ciaBucket = (n: number) => n <= 2 ? 'Low' : n === 3 ? 'Medium' : 'High';
  const ciaCanon: Record<string, number> = { Low: 2, Medium: 3, High: 5 };
  const setCIA = (field: 'confidentiality_rating' | 'integrity_rating' | 'availability_rating', bucket: string) =>
    setForm((f) => ciaBucket(f[field]) === bucket ? f : { ...f, [field]: ciaCanon[bucket] });
  const odBucket = (s: string) => s === 'low' ? 'Low' : s === 'medium' ? 'Medium' : 'High';
  const odCanon: Record<string, string> = { Low: 'low', Medium: 'medium', High: 'high' };
  const setOD = (bucket: string) => setForm((f) => odBucket(f.operational_dependency) === bucket ? f : { ...f, operational_dependency: odCanon[bucket] });
  const rdBucket = (s: string) => (!s || s === 'none') ? 'No' : 'Yes';
  const setRD = (bucket: string) => setForm((f) => rdBucket(f.regulated_data_type) === bucket ? f : { ...f, regulated_data_type: bucket === 'Yes' ? 'pii' : 'none' });
  const aiSuggest = () => setForm((f) => ({
    ...f, confidentiality_rating: 5, integrity_rating: 5, availability_rating: 3,
    is_customer_facing: true, operational_dependency: 'high',
    regulated_data_type: rdBucket(f.regulated_data_type) === 'Yes' ? f.regulated_data_type : 'pii',
  }));
  const maxCIA = Math.max(form.confidentiality_rating, form.integrity_rating, form.availability_rating);
  const derivedCrit = maxCIA >= 5 ? 'Critical' : maxCIA >= 4 ? 'High' : maxCIA >= 3 ? 'Medium' : 'Low';

  const ciaSet = !comp.cia.missing;

  return (
    <div className="inv2" style={root}>
      <style>{`.mono{font-variant-numeric:tabular-nums}`}</style>

      {shell(extraPill, host, subLine, (
        <>
          <Link href={`/assets/${asset.id}`} style={btnSm}>Open asset record <ExternalLink size={13} /></Link>
          <button style={btnSm} onClick={recalc}><RefreshCw size={13} /> Recalculate</button>
        </>
      ))}

      {/* Business impact & scoring inputs opener → CIA modal */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', cursor: 'pointer' }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: '#E4F8F2', color: ACSTRONG, display: 'grid', placeItems: 'center', flex: 'none' }}><SlidersHorizontal size={15} /></span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <b style={{ fontSize: 12.5 }}>Business impact &amp; scoring inputs</b>
            <div style={{ fontSize: 11, color: MUTED }}>CIA ratings <b style={{ color: ciaSet ? '#1F7A54' : '#9A6410' }}>{ciaSet ? `set · derived ${asset.criticality || derivedCrit}` : `auto · ${derivedCrit} (unconfirmed)`}</b> · customer-facing {form.is_customer_facing ? 'yes' : 'no'} · regulated data {rdBucket(form.regulated_data_type).toLowerCase()} — set them to confirm this score{isDirty ? <span style={{ color: '#9A6410' }}> · ● unsaved</span> : null}</div>
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: ACSTRONG }}>Edit ›</span>
        </div>
      </div>

      {/* Why this score — real known dims as weighted bars, unknowns muted */}
      <Card title="Why this score" sub={`weighted dimensions · unknowns excluded & weights renormalise · total ${d.score ?? '—'}/100 · bar = dimension severity, number = points added`} grow>
        {DIMS.map((dim) => {
          const c = comp[dim.key];
          if (!c.known) return <MutedRow key={dim.key} label={dim.label} weight={`${Math.round(d.weights[dim.key] * 100)}%`} note="not assessed → excluded" link={dimLink(dim.key, true)} />;
          const pct = Math.round((c.score ?? 0) * 100);
          return <Hbar key={dim.key} label={dim.label} sub={`${effPct(dim.key)}% of live weight · ${dim.desc}`} pct={pct} pts={d.contributions[dim.key]} col={sevCol(pct)} ev={evidence(dim.key)} link={dimLink(dim.key, false)} />;
        })}
        <div style={{ fontSize: 10, color: FAINT, marginTop: 8 }}>Excluded dimensions are left out of the score rather than counted as zero, so the number isn&apos;t artificially low. Data quality {d.data_quality}% · {d.known_dimensions.length} of 5 signals known.</div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 12, alignItems: 'stretch' }}>
        {/* Top contributors — the real findings adding the most risk */}
        <Card title="Top contributors" sub="the findings adding the most risk — fix these to move the score" grow>
          {topContrib.length === 0 ? (
            <div style={{ fontSize: 11.5, color: MUTED }}>{comp.vuln.active_count > 0 ? <Link href={`/assets/${asset.id}?tab=vulnerabilities`} style={lnkStyle}>See this asset&apos;s findings →</Link> : 'No active findings contributing to this score.'}</div>
          ) : topContrib.map((v) => {
            const vb = BAND[bandOf(v.band, Math.round(v.score * 100))];
            return <ContribRow key={v.vuln_id} dot={vb.bar} title={<span><span className="mono">{v.cve_id || `VULN-${v.vuln_id}`}</span>{v.title ? ` · ${v.title}` : ''}</span>} meta={`${v.severity || vb.label}${v.kev_flag ? ' · KEV' : ''}${v.epss_score != null ? ` · EPSS ${Math.round(Number(v.epss_score) * 100)}%` : ''} · ${(v.score * 10).toFixed(1)}/10`} href={`/vulnerabilities/${v.vuln_id}`} />;
          })}
          <div style={{ fontSize: 10, color: FAINT, marginTop: 'auto', paddingTop: 8 }}>Only a clean re-scan removes a contributor — mapped controls don&apos;t lower this score.</div>
        </Card>

        {/* Posture facts — ONLY the signals the real response carries */}
        <Card title="Posture facts" sub="from the latest agent + Nessus signals" grow>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Kv k="CIA ratings" v={comp.cia.missing ? 'auto · Medium (unconfirmed)' : `C${comp.cia.confidentiality ?? '–'} · I${comp.cia.integrity ?? '–'} · A${comp.cia.availability ?? '–'}`} c={comp.cia.missing ? '#9A6410' : undefined} />
            <Kv k="Criticality" v={asset.criticality || 'Not assessed'} c={asset.criticality ? undefined : FAINT} />
            {assetQ.data ? <Kv k="Customer-facing" v={assetQ.data.is_customer_facing ? 'Yes' : 'No'} /> : null}
            {assetQ.data ? <Kv k="Internet-exposed" v={assetQ.data.is_internet_facing ? 'Yes' : 'No'} c={assetQ.data.is_internet_facing ? '#9A6410' : '#1F7A54'} /> : null}
            {assetQ.data?.regulated_data_type && assetQ.data.regulated_data_type !== 'none' ? <Kv k="Regulated data" v={titleCase(assetQ.data.regulated_data_type)} /> : null}
            <Kv k="Owner" v={asset.owner_name || 'Unassigned'} c={asset.owner_name ? undefined : FAINT} />
            <Kv k="Data quality" v={`${d.data_quality}% · ${d.known_dimensions.length} of 5 signals`} />
          </div>
          <div style={{ fontSize: 10, color: FAINT, marginTop: 8 }}>Endpoint-agent facts (EDR / disk encryption / firewall) and last-scan time aren&apos;t in this response, so they&apos;re omitted rather than guessed.</div>
        </Card>
      </div>

      {/* CIA + business-context modal — tap-pickers over the real save/preview wiring */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }} onClick={() => { hydrateForm(); setOpen(false); }}>
          <div style={{ ...card, width: 560, maxWidth: '100%', padding: 20, boxShadow: '0 20px 50px rgba(2,6,23,.3)', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: 15, fontWeight: 600 }}>Business impact &amp; scoring inputs</h4>
                <p style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>CIA is edited here only — the one place it lives. Saving derives criticality and re-scores this asset.</p>
              </div>
              <button style={btnSm} onClick={() => { hydrateForm(); setOpen(false); }}><X size={14} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(230px,100%),1fr))', gap: '6px 26px', marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 9, color: '#6A54C9' }}>CIA impact ratings · auto-derives criticality</div>
                <PickGroup label="Confidentiality" opts={['Low', 'Medium', 'High']} value={ciaBucket(form.confidentiality_rating)} onPick={(v) => setCIA('confidentiality_rating', v)} />
                <PickGroup label="Integrity" opts={['Low', 'Medium', 'High']} value={ciaBucket(form.integrity_rating)} onPick={(v) => setCIA('integrity_rating', v)} />
                <PickGroup label="Availability" opts={['Low', 'Medium', 'High']} value={ciaBucket(form.availability_rating)} onPick={(v) => setCIA('availability_rating', v)} />
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 9, color: '#2E63A8' }}>Business context · weights the impact</div>
                <PickGroup label="Customer-facing" opts={['Yes', 'No']} value={form.is_customer_facing ? 'Yes' : 'No'} onPick={(v) => setForm((f) => ({ ...f, is_customer_facing: v === 'Yes' }))} />
                <PickGroup label="Regulated data" opts={['Yes', 'No']} value={rdBucket(form.regulated_data_type)} onPick={setRD} />
                <PickGroup label="Operational dependency" opts={['Low', 'Medium', 'High']} value={odBucket(form.operational_dependency)} onPick={setOD} />
              </div>
            </div>

            {/* live preview — reuses the proven previewAsset endpoint */}
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#FAFBFC', border: '1px solid #F0F3F5', fontSize: 11.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: MUTED }}>Now</span>
                <b className="mono">{d.score ?? '—'}/100</b>
                <span style={{ color: FAINT }}>→</span>
                {!isDirty ? <span style={{ color: MUTED }}>change a value to preview</span>
                  : previewQ.isLoading ? <span style={{ color: MUTED }}>computing…</span>
                    : previewQ.isError || !previewQ.data ? <span style={{ color: '#B23A3A' }}>preview unavailable</span>
                      : (
                        <>
                          <b className="mono" style={{ color: BAND[bandOf(previewQ.data.after.band.label, previewQ.data.after.score)].fg }}>{previewQ.data.after.score}/100</b>
                          <span style={{ fontWeight: 600, color: previewQ.data.delta > 0 ? '#B23A3A' : previewQ.data.delta < 0 ? '#1F7A54' : MUTED }}>({previewQ.data.delta > 0 ? '▲ +' : previewQ.data.delta < 0 ? '▼ ' : ''}{previewQ.data.delta.toFixed(2)})</span>
                        </>
                      )}
                <span style={{ marginLeft: 'auto', color: MUTED }}>derives criticality: <b style={{ color: SEC }}>{derivedCrit}</b></span>
              </div>
              <div style={{ fontSize: 10, color: FAINT, marginTop: 4 }}>Preview reflects business-context weighting; CIA ratings re-score on Save.</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, paddingTop: 14, borderTop: '1px solid #F0F3F5', flexWrap: 'wrap' }}>
              <button style={btnSm} onClick={aiSuggest}><Sparkles size={13} /> AI suggest</button>
              <span style={{ fontSize: 10.5, color: FAINT, flex: 1, minWidth: 160 }}>Unpicked fields stay unknown — excluded from the score, never zeroed.</span>
              <button style={btnSm} onClick={() => { hydrateForm(); setOpen(false); }}>Cancel</button>
              <button style={{ ...btnGreen, opacity: (!isDirty || saveMut.isPending) ? 0.5 : 1, cursor: (!isDirty || saveMut.isPending) ? 'not-allowed' : 'pointer' }} disabled={!isDirty || saveMut.isPending} onClick={() => saveMut.mutate()}>{saveMut.isPending ? 'Saving…' : 'Save & recalculate'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PickGroup({ label, opts, value, onPick }: { label: string; opts: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ fontSize: 11, color: SEC, fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'inline-flex', background: '#F1F4F6', borderRadius: 10, padding: 3, gap: 2, flexWrap: 'wrap' }}>
        {opts.map((o) => {
          const on = o === value;
          return <button key={o} onClick={() => onPick(o)} style={{ border: 0, borderRadius: 8, padding: '6px 14px', fontSize: 11.5, fontWeight: 600, background: on ? '#fff' : 'none', color: on ? ACSTRONG : '#6B7787', boxShadow: on ? '0 1px 3px rgba(2,6,23,.12)' : 'none', cursor: 'pointer' }}>{o}</button>;
        })}
      </div>
    </div>
  );
}
