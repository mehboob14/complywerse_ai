'use client';

/*
 * RisksPanel — the asset-detail "Risk & Controls" tab (activeTab === 'risks'),
 * restyled to match the approved RiskControls.html mock (mint-teal tokens,
 * Poppins, ring + dimension-bar residual risk card, findings banner,
 * mapped-controls table with a coverage ring).
 *
 * PRESENTATION ONLY. Every real data source and behavior from the previous
 * version is preserved exactly:
 *   - Residual Risk / CIA / CIS all read the SAME react-query key
 *     (['asset-risk-posture', id]) and the same CIA suggest/save mutations,
 *   - the findings banner reads the vuln component's real `open_count` off
 *     that same query (no new fetch, no fabricated number),
 *   - the control list, risk list and coverage ring are fed by the same
 *     props the parent already computes (allControls, coveragePctFromApi,
 *     link/unlink handlers),
 *   - Mapping Recommendations keeps its own query + accept mutation untouched.
 *
 * The mock only shows the Residual Risk / Findings / Mapped Controls trio —
 * CIA editing, the CIS summary, Associated Risks and Mapping Recommendations
 * have no equivalent in it, so they're kept below (restyled to the same
 * mint-teal language) rather than dropped.
 */

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lock, Cpu, Sparkles, ArrowRight, ShieldCheck, AlertCircle, Loader2,
  Shield, X, AlertTriangle, Plus, Filter, Layers, ChevronDown, ChevronRight,
} from 'lucide-react';
import { assetsApi, riskPostureApi } from '@/lib/api';
import { GuideMarker } from '@/components/guide';
import { InlineLinkPicker, PageLoader } from '@/components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ─── design tokens (mint-teal, mirrors RiskControls.html exactly) ─────── */

const MONO = 'tabular-nums';
const SHADOW = 'shadow-[0_1px_2px_rgba(16,24,40,0.04)]';
const CARD = `bg-white border border-[#E8ECEE] rounded-[15px] overflow-hidden ${SHADOW}`;
const BTN_PRIMARY = 'inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-2 rounded-[9px] whitespace-nowrap border bg-[#17B898] text-[#06342B] border-[#17B898] hover:bg-[#12A085] disabled:opacity-50';
const BTN_GHOST = 'inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-[7px] rounded-[9px] whitespace-nowrap border bg-white text-[#3A4653] border-[#E8ECEE] hover:bg-[#F4F6F7] disabled:opacity-50';

// coverage-status tone + label — single source for the Mapped Controls table.
const covBadge = (s?: string) =>
  s === 'full' ? { label: 'Covered', cls: 'text-[#1F7A54] bg-[#E7F5EE]' }
  : s === 'partial' ? { label: 'Partial', cls: 'text-[#9A6410] bg-[#FBF2DF]' }
  : { label: 'Not set', cls: 'text-[#6B7787] bg-[#F1F4F6]' };

// Confidence-tier chrome for the mapping recommender. Literal class strings so
// Tailwind's JIT keeps them (dynamic interpolation would be purged).
const BAND: Record<'high' | 'medium' | 'low', { headerBg: string; pill: string }> = {
  high:   { headerBg: 'bg-[#E4F8F2]', pill: 'text-[#12A085] bg-[#E4F8F2]' },
  medium: { headerBg: 'bg-[#FBF2DF]', pill: 'text-[#9A6410] bg-[#FBF2DF]' },
  low:    { headerBg: 'bg-[#F1F4F6]', pill: 'text-[#6B7787] bg-[#F1F4F6]' },
};

/* ─── residual bands (higher = worse; thresholds match backend RISK_BANDS) ─ */
const bandTone = (score: number) =>
  score >= 75 ? { fg: '#B23A3A', bg: '#FBEAEA', label: 'severe' }
  : score >= 50 ? { fg: '#9A6410', bg: '#FBF2DF', label: 'elevated' }
  : score >= 25 ? { fg: '#2E63A8', bg: '#E9F1FB', label: 'watch' }
  : { fg: '#1F7A54', bg: '#E7F5EE', label: 'contained' };

const DIMS: { key: string; concept: string; dim: string; guideId: string; guideN: number }[] = [
  { key: 'cia',  concept: 'Impact',        dim: 'CIA ratings', guideId: 'asset.cia', guideN: 2 },
  { key: 'vuln', concept: 'Likelihood',    dim: 'Open vulnerabilities', guideId: 'posture.vulnDimension', guideN: 3 },
  { key: 'ctrl', concept: 'Control gap',   dim: 'Controls not covering this asset', guideId: 'asset.controlCoverage', guideN: 4 },
  { key: 'cis',  concept: 'Hardening gap', dim: 'CIS benchmark failures', guideId: 'asset.cisGap', guideN: 5 },
  { key: 'risk', concept: 'Risk register', dim: 'Linked risks', guideId: 'asset.linkedRisks', guideN: 6 },
];

const CIA_LABELS = ['—', 'Low', 'Low-Med', 'Medium', 'High', 'Critical'];

/* ─── donut ring (residual score + coverage %) ─────────────────────────── */

function Ring({ pct, size = 110, stroke = 12, color, trackColor = '#F0F3F5' }: { pct: number; size?: number; stroke?: number; color: string; trackColor?: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <svg viewBox="0 0 120 120" style={{ width: size, height: size, transform: 'rotate(-90deg)' }} aria-hidden="true">
      <circle cx="60" cy="60" r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
    </svg>
  );
}

/* ─── shared card shell ────────────────────────────────────────────────── */

function BigCard({
  icon, title, guide, subtitle, right, children,
}: { icon: React.ReactNode; title: string; guide?: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-3 px-4 py-[13px] border-b border-[#F0F3F5]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[#8A95A1]">{icon}</span>
            <span className="text-[12.5px] font-semibold text-[#0F1F2B]">{title}</span>
            {guide}
          </div>
          {subtitle && <div className="text-[10.5px] text-[#8A95A1] mt-0.5">{subtitle}</div>}
        </div>
        {right}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

/* ─── residual-risk dimension bar ──────────────────────────────────────── */

function DimBar({ label, sub, pct, known, tone, guideId, guideN, weightPct }: { label: string; sub: string; pct: number; known: boolean; tone: string; guideId?: string; guideN?: number; weightPct?: number }) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)_38px] gap-3 items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0F1F2B]">
          {label}
          {weightPct != null && (
            <span className="rounded bg-[#F0F3F5] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[#3A4653]">{weightPct}%</span>
          )}
          {guideId && guideN != null && <GuideMarker id={guideId} n={guideN} />}
        </div>
        <div className="text-[10px] text-[#AEB8C2] truncate">{sub}</div>
      </div>
      <div className="h-[9px] rounded-full bg-[#F0F3F5] overflow-hidden">
        {known && <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: tone }} />}
      </div>
      <div className="text-right text-[12px] font-semibold tabular-nums text-[#0F1F2B]">
        {known ? Math.round(pct) : <span className="text-[#AEB8C2] font-medium">—</span>}
      </div>
    </div>
  );
}

/* ─── Card 1: Residual Risk (single source: /risk-posture/asset/{id}) ───── */

function ResidualRiskCard({ assetId, asset }: { assetId: number; asset: any }) {
  const q = useQuery({
    queryKey: ['asset-risk-posture', assetId],
    queryFn: async () => (await riskPostureApi.asset(assetId)).data as any,
  });
  const d = q.data;
  const score = d?.score ?? null;
  const tone = score != null ? bandTone(score) : null;
  const isEasm = d?.mode === 'easm';
  const rows: { key: string; concept: string; dim: string; pct: number; known: boolean; positive: string | null; guideId?: string; guideN?: number; weightPct?: number }[] = isEasm
    ? Object.entries(d.components || {}).map(([key, c]: [string, any]) => ({
        key,
        concept: c.label || key,
        dim: c.detail || '',
        pct: Math.round((c.score ?? 0) * 100),
        known: true,
        positive: null,
        weightPct: c.weight_pct ?? Math.round((c.weight ?? 0) * 100),
      }))
    : DIMS.map((x) => {
        const c = d?.components?.[x.key];
        return {
          key: x.key, concept: x.concept, dim: x.dim, pct: (c?.score ?? 0) * 100, known: !!c?.known,
          positive: c?.coverage_pct != null ? `${Math.round(c.coverage_pct)}% of controls cover it`
            : c?.pass_rate != null ? `${c.pass_rate}% of checks pass`
            : c?.open_count != null ? `${c.open_count} open`
            : null,
          guideId: x.guideId, guideN: x.guideN,
        };
      });
  const total = rows.length;
  const knownCount = rows.filter((r) => r.known).length;
  const cve = d?.cve_detection;

  const card = (
    <BigCard
      icon={<AlertTriangle size={15} />}
      title={isEasm ? 'Compromise risk' : 'Residual Risk'}
      guide={isEasm ? undefined : <GuideMarker id="asset.residualRisk" n={1} />}
      subtitle={isEasm ? 'Likelihood × impact: hygiene (one factor) + exploitability + exposure + business context. Not 100 minus health.' : `Weighted composite of ${total} signals · higher = more risk`}
      right={
        <Link href={`/risk-posture/asset/${assetId}`} className="flex items-center gap-1 text-[11px] font-semibold text-[#12A085] hover:text-[#17B898] whitespace-nowrap mt-px">
          Full posture <ArrowRight size={12} />
        </Link>
      }
    >
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-[#8A95A1]"><Loader2 size={14} className="animate-spin" /> Computing risk…</div>
      ) : !d ? (
        <div className="py-6 text-[13px] text-[#8A95A1]">Risk posture is unavailable for this asset.</div>
      ) : score == null || !tone ? (
        <div className="py-6 text-[13px] text-[#8A95A1]">
          No risk score yet — this asset hasn’t been assessed. Add CIA ratings, link controls or risks, or run a CIS scan to compute its residual risk.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[128px_minmax(0,1fr)] gap-5 items-center">
            <div>
              <div className="relative w-[110px] h-[110px] mx-auto">
                <Ring pct={score} color={tone.fg} />
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <b className="block text-[26px] font-semibold leading-none tabular-nums" style={{ color: tone.fg }}>{Math.round(score)}</b>
                    <small className="block text-[10px] text-[#AEB8C2] mt-0.5">of 100</small>
                  </div>
                </div>
              </div>
              <span className="block w-max max-w-full mx-auto mt-[9px] text-center rounded-full px-2.5 py-[2px] text-[10px] font-semibold" style={{ color: tone.fg, background: tone.bg }}>
                {d.band?.label ?? tone.label} risk
              </span>
              {(asset?.internet_facing || (asset?.criticality || '').toLowerCase() === 'critical') && (
                <div className="flex justify-center gap-1 mt-2 flex-wrap">
                  {asset?.internet_facing && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-[#B23A3A] bg-[#FBEAEA]">exposed</span>}
                  {(asset?.criticality || '').toLowerCase() === 'critical' && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-[#B23A3A] bg-[#FBEAEA]">critical</span>}
                </div>
              )}
            </div>

            <div className="grid gap-[11px]">
              {rows.map((r) => (
                <DimBar
                  key={r.key}
                  label={r.concept}
                  sub={r.positive ? `${r.dim} · ${r.positive}` : r.dim}
                  pct={r.pct}
                  known={r.known}
                  tone={tone.fg}
                  guideId={r.guideId}
                  guideN={r.guideN}
                  weightPct={r.weightPct}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 pt-[11px] border-t border-[#F0F3F5] flex items-center justify-between gap-3 text-[11px] text-[#8A95A1] flex-wrap">
            <span>
              <b className="text-[#0F1F2B]">{knownCount} of {total}</b> signals known{d.data_quality != null ? ` · ${Math.round(d.data_quality)}% data quality` : ''}
              {!isEasm && <GuideMarker id="posture.dataQuality" n={7} />}
            </span>
            {knownCount < total && (
              <span className="max-w-[420px]">Unknown signals (no data yet) are excluded from the score rather than counted as zero, so the number isn’t artificially low.</span>
            )}
          </div>
          {isEasm && cve && (
            <p className="mt-3 rounded-lg border border-[#F0DCAE] bg-[#FBF2DF] px-3 py-2 text-[11.5px] leading-relaxed text-[#5c4a1a]">
              <b>How CVEs are detected:</b> {cve.limits || 'Banner → CPE heuristic plus findings already linked to this host. Not an active exploit test.'}
              {cve.banner_cpe ? ` Banner CPE: ${cve.banner_cpe}.` : ''}
              {` Linked findings: ${cve.linked_findings ?? 0}${cve.kev_findings ? ` · KEV: ${cve.kev_findings}` : ''}.`}
            </p>
          )}
        </>
      )}
    </BigCard>
  );
  if (isEasm) {
    return <div className="rounded-[17px] border-2 border-[#9A6410] bg-[#FBF2DF] p-0.5">{card}</div>;
  }
  return card;
}

/* ─── Findings banner: open vuln count, feeds the Likelihood signal ────── */

function FindingsBanner({ assetId }: { assetId: number }) {
  const q = useQuery({
    queryKey: ['asset-risk-posture', assetId],
    queryFn: async () => (await riskPostureApi.asset(assetId)).data as any,
  });
  const openCount = q.data?.components?.vuln?.open_count;
  if (openCount == null) return null; // unknown (e.g. EASM assets) — don't fabricate a number

  return (
    <Link href="/vulnerabilities" className={CARD + ' flex items-center gap-3 px-4 py-[14px] hover:border-[#AEB8C2] transition-colors'}>
      <div className="w-[34px] h-[34px] rounded-[10px] bg-[#FBEAEA] text-[#B23A3A] grid place-items-center flex-none">
        <AlertTriangle size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[21px] font-semibold text-[#B23A3A] tabular-nums">{openCount}</span>{' '}
        <span className="text-[12.5px] font-semibold text-[#0F1F2B]">open finding{openCount === 1 ? '' : 's'}</span>
        <p className="text-[11px] text-[#8A95A1] mt-0.5">Unresolved vulnerabilities detected on this asset — feeds the Likelihood signal above.</p>
      </div>
      <span className="text-[12px] font-semibold text-[#12A085] whitespace-nowrap flex items-center gap-1 flex-none">
        View in Vulnerabilities <ArrowRight size={12} />
      </span>
    </Link>
  );
}

/* ─── Card 2: CIA Impact Ratings (editable, single home) ──────────────── */

function CIACard({ assetId, asset }: { assetId: number; asset: any }) {
  const qc = useQueryClient();
  const [c, setC] = useState(asset.confidentiality_rating || 0);
  const [i, setI] = useState(asset.integrity_rating || 0);
  const [a, setA] = useState(asset.availability_rating || 0);
  const [rationale, setRationale] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setC(asset.confidentiality_rating || 0);
    setI(asset.integrity_rating || 0);
    setA(asset.availability_rating || 0);
  }, [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggest = useMutation({
    mutationFn: async () => (await assetsApi.getCIARecommendation({
      name: asset.name, description: asset.description, asset_type: asset.asset_type,
      vendor: asset.vendor, location: asset.location, criticality: asset.criticality,
    })).data,
    onSuccess: (r: any) => {
      setC(r.confidentiality_rating); setI(r.integrity_rating); setA(r.availability_rating);
      setRationale(r.recommendation || null); setDirty(true);
    },
  });

  const save = useMutation({
    mutationFn: () => assetsApi.update(assetId, { confidentiality_rating: c, integrity_rating: i, availability_rating: a } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      qc.invalidateQueries({ queryKey: ['asset', assetId] });
      qc.invalidateQueries({ queryKey: ['asset-risk-posture', assetId] });
      setDirty(false); setRationale(null);
    },
  });

  const Row = ({ label, value, set }: { label: string; value: number; set: (n: number) => void }) => (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-28 flex-none text-[12px] text-[#3A4653]">{label}</span>
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => { set(n); setDirty(true); }}
            title={CIA_LABELS[n]}
            className="h-[22px] flex-1 rounded transition-colors"
            style={{ background: n <= value ? (value >= 4 ? '#B23A3A' : value === 3 ? '#9A6410' : '#2E63A8') : '#F0F3F5' }}
          />
        ))}
      </div>
      <span className="w-16 flex-none text-right text-[11.5px] font-semibold text-[#3A4653]">{value ? CIA_LABELS[value] : '—'}</span>
    </div>
  );

  return (
    <BigCard
      icon={<Lock size={15} />}
      title="CIA Impact Ratings"
      guide={<GuideMarker id="asset.cia" n={8} />}
      right={
        <span className="rounded-full bg-[#F1F4F6] px-2 py-0.5 text-[10.5px] font-semibold text-[#6B7787] whitespace-nowrap">
          {asset.criticality_manual_override ? 'manual override' : 'auto-derived'}
        </span>
      }
    >
      <Row label="Confidentiality" value={c} set={setC} />
      <Row label="Integrity" value={i} set={setI} />
      <Row label="Availability" value={a} set={setA} />

      {rationale && (
        <p className="mt-3 rounded-lg bg-[#E4F8F2] px-3 py-2 text-[12px] leading-relaxed text-[#0F1F2B]">
          <b>AI:</b> {rationale}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#F0F3F5] pt-3">
        <button onClick={() => suggest.mutate()} disabled={suggest.isPending} className={BTN_GHOST}>
          {suggest.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI suggest
        </button>
        <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className={BTN_PRIMARY}>
          {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Save &amp; recalculate
        </button>
        {save.isSuccess && !dirty && <span className="text-[12px] text-[#1F7A54]">Saved — risk recalculated.</span>}
      </div>
      <p className="mt-2 text-[11px] text-[#AEB8C2]">
        Saving updates the asset’s derived criticality and re-scores its risk. CIA is edited here only — the one place it lives.
      </p>
    </BigCard>
  );
}

/* ─── Card 3: CIS Benchmark Compliance (summary → Compliance tab) ──────── */

function CISCard({ assetId, onOpenCompliance }: { assetId: number; onOpenCompliance?: () => void }) {
  const q = useQuery({
    queryKey: ['asset-risk-posture', assetId],
    queryFn: async () => (await riskPostureApi.asset(assetId)).data as any,
  });
  const cis = q.data?.components?.cis;
  const hardening = cis?.pass_rate != null ? Math.round(cis.pass_rate) : null;

  return (
    <BigCard
      icon={<Cpu size={15} />}
      title="CIS Benchmark Compliance"
      guide={<GuideMarker id="asset.cisGap" n={9} />}
      subtitle={'Continuously monitored · feeds the "Hardening gap" signal above.'}
      right={onOpenCompliance ? (
        <button onClick={onOpenCompliance} className="flex items-center gap-1 text-[11px] font-semibold text-[#12A085] hover:text-[#17B898] whitespace-nowrap">
          Full scans <ArrowRight size={12} />
        </button>
      ) : undefined}
    >
      {!cis || !cis.known ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-[#E8ECEE] bg-[#F4F6F7] px-4 py-3 text-[12.5px] text-[#8A95A1]">
          <AlertCircle size={14} className="mt-0.5 flex-none" />
          No CIS benchmark has been scanned against this asset yet. Run a scan from the Compliance tab to populate this.
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-[22px] font-semibold text-[#0F1F2B] tabular-nums">{hardening ?? '—'}</span>
            <span className="text-[12px] text-[#8A95A1]">/ 100 hardening</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[12.5px]">
            <span className="text-[#1F7A54]"><b>{cis.passed ?? 0}</b> pass</span>
            <span className="text-[#B23A3A]"><b>{cis.failed ?? 0}</b> fail</span>
            {cis.total != null && <span className="text-[#8A95A1]">of {cis.total} checks</span>}
            {cis.ip_group_augmented && <span className="text-[#AEB8C2]">· blended with co-located assets</span>}
          </div>
        </>
      )}
    </BigCard>
  );
}

/* ─── Mapped Controls: coverage ring + table (was ControlsSection) ─────── */

type CtrlLink = { id: number; code?: string; internal_control_id?: number; name: string; category?: string; coverage_status?: string };

const KIND_LABEL: Record<'internal' | 'framework' | 'legacy', string> = {
  internal: 'Internal Control', framework: 'Framework Control', legacy: 'Legacy Control',
};

function MappedControlsCard({
  asset, allControls, controlsLoading, coveragePctFromApi,
  onLinkControl, isLinkingControl,
  onUnlinkInternalControl, onUnlinkFrameworkControl, isUnlinkingInternal, isUnlinkingFramework,
}: {
  asset: RisksPanelAsset;
  allControls: Array<{ id: number | string; internal_id?: string; name: string; category?: string }>;
  controlsLoading: boolean;
  coveragePctFromApi?: number | null;
  onLinkControl: (controlId: number) => void;
  isLinkingControl: boolean;
  onUnlinkInternalControl: (linkId: number) => void;
  onUnlinkFrameworkControl: (linkId: number) => void;
  isUnlinkingInternal: boolean;
  isUnlinkingFramework: boolean;
}) {
  const linkedControlIds = asset.linked_internal_controls?.map((c) => c.internal_control_id) || [];
  const controlPickerItems = allControls
    .filter((c) => !linkedControlIds.includes(Number(c.id)))
    .map((c) => ({
      value: String(c.id),
      label: c.internal_id ? `${c.internal_id} — ${c.name}` : c.name,
      subLabel: c.category,
    }));

  type Row = CtrlLink & { kind: 'internal' | 'framework' | 'legacy' };
  const rows: Row[] = [
    ...(asset.linked_internal_controls || []).map((c) => ({ ...c, kind: 'internal' as const })),
    ...(asset.linked_framework_controls || []).map((c) => ({ ...c, kind: 'framework' as const })),
    ...(asset.linked_controls || []).map((c) => ({ ...c, kind: 'legacy' as const })),
  ];
  const totalControls = rows.length;
  const pct = coveragePctFromApi ?? null;
  const ringColor = pct == null ? '#AEB8C2' : pct < 40 ? '#B23A3A' : pct < 70 ? '#9A6410' : '#1F7A54';

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3.5 px-4 py-[14px] border-b border-[#F0F3F5]">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[#0F1F2B]">
            <Shield size={15} className="text-[#8A95A1]" />
            Mapped Controls
            <span className="rounded-full bg-[#F1F4F6] text-[#6B7787] px-2 py-0.5 text-[11px] font-bold">{totalControls}</span>
          </h3>
          <p className="text-[11px] text-[#8A95A1] mt-[3px] max-w-[420px]">
            Controls applied to this asset across Internal Controls, Framework Controls, and the Normalized Control Library. Mapping more reduces this asset’s contribution to the tenant’s risk score.
          </p>
        </div>
        <div className="flex items-center gap-4 flex-none">
          <div>
            <div className="relative w-14 h-14">
              <Ring pct={pct ?? 0} size={56} stroke={9} color={ringColor} />
              <div className="absolute inset-0 grid place-items-center text-[13px] font-bold tabular-nums" style={{ color: ringColor }}>
                {pct != null ? `${Math.round(pct)}%` : '—'}
              </div>
            </div>
            <div className="text-[9.5px] text-[#8A95A1] text-center mt-[3px]">coverage</div>
          </div>
          <InlineLinkPicker
            triggerLabel="+ Map Control"
            triggerClassName={BTN_PRIMARY}
            items={controlPickerItems}
            isLoading={controlsLoading || isLinkingControl}
            emptyText="No controls available"
            searchPlaceholder="Search controls"
            onSelect={(value) => onLinkControl(Number(value))}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Control', 'Framework', 'Status', 'Coverage'].map((h) => (
                <th key={h} className="text-[9.5px] uppercase tracking-[0.04em] text-[#8A95A1] text-left font-semibold px-4 py-[9px] border-b border-[#F0F3F5] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {totalControls === 0 ? (
              <tr><td colSpan={4}>
                <div className="py-[30px] px-4 text-center">
                  <div className="w-9 h-9 rounded-[11px] bg-[#F0F3F5] text-[#AEB8C2] grid place-items-center mx-auto mb-2.5">
                    <ShieldCheck size={18} />
                  </div>
                  <p className="text-[12px] text-[#8A95A1] inline-flex items-center gap-1.5 flex-wrap justify-center">
                    No controls mapped yet ·
                    <InlineLinkPicker
                      triggerLabel="Map controls →"
                      triggerIcon={<></>}
                      triggerClassName="text-[12px] font-semibold text-[#12A085] hover:text-[#17B898]"
                      items={controlPickerItems}
                      isLoading={controlsLoading || isLinkingControl}
                      emptyText="No controls available"
                      searchPlaceholder="Search controls"
                      onSelect={(value) => onLinkControl(Number(value))}
                    />
                  </p>
                </div>
              </td></tr>
            ) : (
              rows.map((c, idx) => {
                const status = covBadge(c.coverage_status);
                const onUnlink = c.kind === 'internal' ? () => onUnlinkInternalControl(c.id)
                  : c.kind === 'framework' ? () => onUnlinkFrameworkControl(c.id)
                  : undefined;
                const unlinking = c.kind === 'internal' ? isUnlinkingInternal : isUnlinkingFramework;
                return (
                  <tr key={`${c.kind}-${c.id}-${idx}`} className="border-b border-[#F0F3F5] last:border-0 hover:bg-[#F4F6F7]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 justify-between">
                        <div className="min-w-0">
                          {c.code && <span className={'block text-[10.5px] font-bold text-[#12A085] ' + MONO}>{c.code}</span>}
                          <p className="text-[12px] font-semibold text-[#0F1F2B] truncate">{c.name}</p>
                        </div>
                        {onUnlink && (
                          <button onClick={onUnlink} disabled={unlinking} className="rounded p-1 text-[#AEB8C2] hover:text-[#B23A3A] disabled:opacity-50 flex-none" title="Unlink Control">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[11.5px] text-[#3A4653] whitespace-nowrap">{c.category || KIND_LABEL[c.kind]}</td>
                    <td className="px-4 py-2.5">
                      <span className={'rounded-full px-2 py-[2px] text-[10.5px] font-semibold ' + status.cls}>{status.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[11.5px] text-[#3A4653] capitalize whitespace-nowrap">{c.coverage_status || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Manage: Associated Risks (props-driven, was RisksTab) ────────────── */

function RisksSection({ asset }: { asset: RisksPanelAsset }) {
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[#0F1F2B]">
        <AlertTriangle size={16} className="text-[#12A085]" />
        Associated Risks
        <span className="rounded-full bg-[#F1F4F6] px-2 py-0.5 text-[11px] font-bold text-[#6B7787]">{asset.linked_risks?.length || 0}</span>
      </h3>

      {asset.linked_risks && asset.linked_risks.length > 0 ? (
        <div className="space-y-2">
          {asset.linked_risks.map((risk) => (
            <div key={risk.risk_id} className="flex items-center justify-between gap-3 rounded-xl border border-[#F0F3F5] bg-[#F4F6F7] px-3.5 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <AlertTriangle size={16} className="text-[#9A6410] flex-none" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-[#0F1F2B] break-words">{risk.title || `Risk #${risk.risk_id}`}</p>
                  <p className="text-[11px] text-[#8A95A1]">Risk ID: {risk.risk_id}{risk.status ? ` • ${risk.status}` : ''}</p>
                </div>
              </div>
              <Link href={`/erm/risks/${risk.risk_id}`} className="text-[12px] font-semibold text-[#12A085] hover:text-[#17B898] whitespace-nowrap">
                View Details
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[#E8ECEE] bg-[#F4F6F7] px-4 py-3 text-[12.5px] text-[#8A95A1]">
          No risks linked to this asset. Risks are linked from the risk register.
        </p>
      )}
    </div>
  );
}

/* ─── Manage: Mapping Recommendations (self-fetching, untouched logic) ──── */

interface MatchedSignal { key: string; label: string; weight: number }
interface MappingRecommendation {
  framework_control_id: number;
  framework_id: number | null;
  framework_name: string | null;
  framework_short_code: string | null;
  code: string;
  name: string;
  statement: string | null;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  matched_signals: MatchedSignal[];
  negative_notes: string[];
}
interface MappingRecommendationsResponse {
  recommendations: MappingRecommendation[];
  total_controls_scanned: number;
  total_already_linked: number;
  asset_profile: Record<string, unknown>;
}

function MappingRecommendationsSection({ assetId }: { assetId: number }) {
  const queryClient = useQueryClient();
  const [frameworkFilter, setFrameworkFilter] = useState<number | ''>('');
  const [minScore, setMinScore] = useState<number>(1);
  const [includeLinked, setIncludeLinked] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [coverageStatus, setCoverageStatus] = useState<'partial' | 'full' | 'minimal'>('partial');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const recsQuery = useQuery<MappingRecommendationsResponse>({
    queryKey: ['asset-mapping-recommendations', assetId, frameworkFilter, minScore, includeLinked],
    queryFn: async () => {
      const params: Record<string, unknown> = { min_score: minScore, limit: 200 };
      if (frameworkFilter !== '') params.framework_id = frameworkFilter;
      if (includeLinked) params.include_linked = true;
      const r = await assetsApi.getMappingRecommendations(assetId, params);
      return r.data;
    },
    enabled: Number.isFinite(assetId) && assetId > 0,
  });

  const acceptMutation = useMutation({
    mutationFn: (ids: number[]) => assetsApi.acceptMappingRecommendations(assetId, ids, coverageStatus),
    onSuccess: (response: { data: { linked: number; skipped_existing: number; skipped_missing: number } }) => {
      const { linked, skipped_existing } = response.data;
      setBannerMessage(
        `Linked ${linked} control${linked === 1 ? '' : 's'}` +
          (skipped_existing ? ` (${skipped_existing} already linked)` : '') + '.'
      );
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['asset-mapping-recommendations', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
    },
  });

  const data = recsQuery.data;
  const recs = data?.recommendations || [];

  const frameworkOptions = useMemo(() => {
    const seen = new Map<number, string>();
    recs.forEach((r) => {
      if (r.framework_id != null && r.framework_name && !seen.has(r.framework_id)) {
        seen.set(r.framework_id, r.framework_name);
      }
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [recs]);

  const groups = useMemo(() => {
    const buckets = { high: [] as MappingRecommendation[], medium: [] as MappingRecommendation[], low: [] as MappingRecommendation[] };
    recs.forEach((r) => buckets[r.confidence].push(r));
    return buckets;
  }, [recs]);

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllOfConfidence = (confidence: 'high' | 'medium' | 'low') => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      groups[confidence].forEach((r) => next.add(r.framework_control_id));
      return next;
    });
  };
  const acceptSelected = () => { if (selectedIds.size > 0) acceptMutation.mutate(Array.from(selectedIds)); };
  const acceptOne = (id: number) => acceptMutation.mutate([id]);

  if (recsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-[15px] border border-[#E8ECEE] bg-white py-12">
        <PageLoader size="sm" />
      </div>
    );
  }
  if (recsQuery.error) {
    return (
      <div className="rounded-lg bg-[#FBEAEA] p-4 text-[13px] text-[#B23A3A]">
        Failed to load mapping recommendations.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {bannerMessage && (
        <div className="flex items-center justify-between rounded-lg bg-[#E7F5EE] px-3 py-2 text-[13px] text-[#1F7A54]">
          <span>{bannerMessage}</span>
          <button type="button" onClick={() => setBannerMessage(null)} className="text-[#1F7A54] hover:text-[#12A085]" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[#0F1F2B]">
        <Sparkles className="h-4 w-4 text-[#9A6410]" />
        Auto-suggested framework controls
      </h3>

      <div className="rounded-[15px] border border-[#E8ECEE] bg-[#F4F6F7] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-[#3A4653]">
            <Filter className="h-3.5 w-3.5 text-[#8A95A1]" />
            Framework
            <select
              value={frameworkFilter}
              onChange={(e) => setFrameworkFilter(e.target.value === '' ? '' : Number(e.target.value))}
              className="rounded-[9px] border border-[#E8ECEE] bg-white px-2 py-1 text-[12px] text-[#0F1F2B] focus:border-[#17B898] focus:outline-none"
            >
              <option value="">All</option>
              {frameworkOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[#3A4653]">
            Min score
            <input type="range" min={1} max={12} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="h-1 w-32 accent-[#17B898]" />
            <span className="w-6 text-center font-semibold text-[#0F1F2B]">{minScore}</span>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[#3A4653]">
            <input type="checkbox" checked={includeLinked} onChange={(e) => setIncludeLinked(e.target.checked)} className="h-3.5 w-3.5 rounded border-[#E8ECEE] text-[#17B898] focus:ring-[#17B898]" />
            Include already-linked
          </label>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-[#3A4653]">
              Link as
              <select
                value={coverageStatus}
                onChange={(e) => setCoverageStatus(e.target.value as 'partial' | 'full' | 'minimal')}
                className="rounded-[9px] border border-[#E8ECEE] bg-white px-2 py-1 text-[12px] text-[#0F1F2B] focus:border-[#17B898] focus:outline-none"
              >
                <option value="partial">Partial</option>
                <option value="full">Full</option>
                <option value="minimal">Minimal</option>
              </select>
            </label>
            <button
              type="button"
              disabled={selectedIds.size === 0 || acceptMutation.isPending}
              onClick={acceptSelected}
              className={BTN_PRIMARY + ' px-3 py-1.5'}
            >
              {acceptMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Link {selectedIds.size} selected
            </button>
          </div>
        </div>
      </div>

      {recs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[15px] border border-dashed border-[#E8ECEE] bg-[#F4F6F7] py-10 px-4 text-center">
          <ShieldCheck className="mb-3 h-10 w-10 text-[#AEB8C2]" />
          <h4 className="text-[15px] font-semibold text-[#0F1F2B]">No recommendations</h4>
        </div>
      ) : (
        (['high', 'medium', 'low'] as const).map((band) => {
          const list = groups[band];
          if (list.length === 0) return null;
          const cls = BAND[band];
          return (
            <div key={band} className="overflow-hidden rounded-[15px] border border-[#E8ECEE] bg-white">
              <div className={`flex items-center justify-between border-b border-[#F0F3F5] ${cls.headerBg} px-3 py-2`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold capitalize ${cls.pill}`}>
                    {band} confidence
                  </span>
                  <span className="text-[12px] text-[#3A4653]">{list.length} control{list.length === 1 ? '' : 's'}</span>
                </div>
                <button type="button" onClick={() => selectAllOfConfidence(band)} className="text-[12px] font-semibold text-[#12A085] hover:underline">
                  Select all
                </button>
              </div>
              <ul className="divide-y divide-[#F0F3F5]">
                {list.map((r) => {
                  const isSelected = selectedIds.has(r.framework_control_id);
                  const isExpanded = expandedId === r.framework_control_id;
                  return (
                    <li key={r.framework_control_id} className={isSelected ? 'bg-[#E4F8F2]' : ''}>
                      <div className="flex items-start gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(r.framework_control_id)}
                          className="mt-1 h-4 w-4 rounded border-[#E8ECEE] text-[#17B898] focus:ring-[#17B898]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={'rounded bg-[#F1F4F6] px-1.5 py-0.5 text-[11px] text-[#3A4653] ' + MONO}>{r.code}</span>
                            <span className="text-[13px] font-semibold text-[#0F1F2B]">{r.name}</span>
                            {r.framework_short_code && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#E8ECEE] px-2 py-0.5 text-[11px] text-[#6B7787]">
                                <Layers className="h-3 w-3" />
                                {r.framework_short_code}
                              </span>
                            )}
                            <span className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls.pill}`}>
                              Score {r.score}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.matched_signals.map((s) => (
                              <span key={s.key} title={`+${s.weight}`} className="inline-flex items-center rounded-full bg-[#E7F5EE] px-2 py-0.5 text-[11px] text-[#1F7A54]">
                                {s.label}
                              </span>
                            ))}
                            {r.negative_notes.map((n, i) => (
                              <span key={`n-${i}`} className="inline-flex items-center rounded-full bg-[#FBEAEA] px-2 py-0.5 text-[11px] text-[#B23A3A]">
                                {n}
                              </span>
                            ))}
                          </div>
                          {isExpanded && r.statement && (
                            <p className="mt-2 rounded-md bg-[#F4F6F7] border border-[#F0F3F5] p-2 text-[12px] leading-relaxed text-[#3A4653]">
                              {r.statement}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : r.framework_control_id)}
                            className="rounded p-1 text-[#8A95A1] hover:bg-[#F1F4F6] hover:text-[#3A4653]"
                            title={isExpanded ? 'Collapse' : 'Show statement'}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            disabled={acceptMutation.isPending}
                            onClick={() => acceptOne(r.framework_control_id)}
                            className="inline-flex items-center gap-1 rounded-[9px] border border-[#E8ECEE] bg-white px-2 py-1 text-[12px] text-[#3A4653] hover:bg-[#F4F6F7] disabled:opacity-50"
                          >
                            <Plus className="h-3 w-3" /> Link
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ─── props & panel ────────────────────────────────────────────────────── */

interface RiskLink { risk_id: number; title?: string; status?: string }

export interface RisksPanelAsset {
  id: number;
  name?: string;
  description?: string | null;
  asset_type?: string;
  vendor?: string | null;
  location?: string | null;
  criticality?: string;
  confidentiality_rating?: number;
  integrity_rating?: number;
  availability_rating?: number;
  criticality_manual_override?: boolean;
  internet_facing?: boolean;
  last_seen_source?: string | null;
  origin_source?: string | null;
  platform_properties?: any;
  linked_controls?: CtrlLink[];
  linked_internal_controls?: CtrlLink[];
  linked_framework_controls?: CtrlLink[];
  linked_risks?: RiskLink[];
  coverage_percentage?: number;
}

export interface RisksPanelProps {
  assetId: number;
  asset: RisksPanelAsset;
  onOpenCompliance?: () => void;
  /** Authoritative coverage % from /assets/{id}/coverage-analysis (kept for parity; the cards above own the headline number). */
  coveragePctFromApi?: number | null;
  allControls: Array<{ id: number | string; internal_id?: string; name: string; category?: string }>;
  controlsLoading: boolean;
  onLinkControl: (controlId: number) => void;
  isLinkingControl: boolean;
  onUnlinkInternalControl: (linkId: number) => void;
  onUnlinkFrameworkControl: (linkId: number) => void;
  isUnlinkingInternal: boolean;
  isUnlinkingFramework: boolean;
}

export default function RisksPanel({
  assetId, asset, onOpenCompliance, coveragePctFromApi,
  allControls, controlsLoading, onLinkControl, isLinkingControl,
  onUnlinkInternalControl, onUnlinkFrameworkControl, isUnlinkingInternal, isUnlinkingFramework,
}: RisksPanelProps) {
  // External (EASM) assets have no CIA ratings or CIS baseline — those two
  // editable cards don't apply; the Residual Risk card shows the exposure
  // dimensions that do.
  const isExternal = !!(asset?.platform_properties?.external_probe) || asset?.last_seen_source === 'external' || asset?.origin_source === 'easm';
  return (
    <div className="space-y-3.5 font-sans text-[13.5px] text-[#0F1F2B]">
      {isExternal && (
        <div className="rounded-[13px] border border-[#2E63A8] bg-[#E9F1FB] px-4 py-3">
          <div className="text-[11px] font-bold tracking-[0.06em] uppercase text-[#2E63A8]">Public attack surface</div>
          <p className="mt-0.5 text-[12.5px] text-[#3A4653]">
            This host was found from the internet. This tab shows its compromise risk. The configuration-hygiene score and its per-parameter breakdown live on the <b>Overview</b> tab — click the hygiene card there. Internal CIA / CIS scores do not apply.
          </p>
        </div>
      )}

      {/* Reproduces RiskControls.html main content 1:1: ring + dimension
          bars, findings banner, mapped-controls table with coverage ring. */}
      <ResidualRiskCard assetId={assetId} asset={asset} />
      <FindingsBanner assetId={assetId} />
      <MappedControlsCard
        asset={asset}
        allControls={allControls}
        controlsLoading={controlsLoading}
        coveragePctFromApi={coveragePctFromApi}
        onLinkControl={onLinkControl}
        isLinkingControl={isLinkingControl}
        onUnlinkInternalControl={onUnlinkInternalControl}
        onUnlinkFrameworkControl={onUnlinkFrameworkControl}
        isUnlinkingInternal={isUnlinkingInternal}
        isUnlinkingFramework={isUnlinkingFramework}
      />

      {!isExternal && (
        <div className="grid gap-3.5 lg:grid-cols-2">
          <CIACard assetId={assetId} asset={asset} />
          <CISCard assetId={assetId} onOpenCompliance={onOpenCompliance} />
        </div>
      )}

      {/* Below the fold: real management the mock doesn't show — associated
          risks and AI-suggested mappings. */}
      <div className="mt-5 border-t-2 border-[#E8ECEE] pt-4">
        <div className="mb-3">
          <div className="text-[11px] font-bold tracking-[0.06em] uppercase text-[#3A4653]">Manage</div>
          <p className="mt-0.5 text-[12px] text-[#8A95A1]">What else feeds the scores above — linked risks and AI-suggested control mappings.</p>
        </div>
        <div className="space-y-5">
          <RisksSection asset={asset} />
          <MappingRecommendationsSection assetId={assetId} />
        </div>
      </div>
    </div>
  );
}
