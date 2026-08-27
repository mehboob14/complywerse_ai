'use client';

/*
 * RisksPanel — the asset-detail "Risk & Controls" tab (activeTab === 'risks'),
 * restyled VERBATIM into the delivered Overview design language
 * (see ../_overview-design.tsx — warm cards, IBM Plex Mono values, green accent).
 *
 * PRESENTATION ONLY. This is a drop-in replacement for the old
 * <RiskControlsTab><ControlsTab/><RisksTab/><MappingRecommendationsTab/></RiskControlsTab>
 * block in page.tsx. Every data source and capability is preserved exactly:
 *   - three top cards each read the SAME react-query keys / mutations as before
 *     (['asset-risk-posture', id] for Residual + CIS, CIA suggest/save mutations),
 *   - the control list, risk list and coverage summary are fed by the same props
 *     the parent already computes,
 *   - Mapping Recommendations keeps its own query + accept mutation untouched.
 *
 * The design tokens below mirror _overview-design.tsx one-for-one; no colours or
 * spacing are invented. Band/semantic colours (residual bands, CIA rating scale,
 * confidence tiers) are meaning-bearing and kept from the original component.
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

/* ─── design tokens (mirror _overview-design.tsx exactly) ──────────────── */

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e6e9e3] rounded-2xl overflow-hidden ${SHADOW}`;
const PILL_OK = 'inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.03em] uppercase text-[#0f7a5c] bg-[#e7f6ee] border border-[#c3ead2] px-2.5 py-[3px] rounded-full';
const INPUT = 'text-[12.5px] px-3 py-[7px] border border-[#dfe3db] rounded-lg bg-[#f9faf8] outline-none focus:border-[#0d5c48] text-[#1a2b24]';
const BTN_PRIMARY = 'inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap border bg-[#0d5c48] text-white border-[#0d5c48] disabled:opacity-50';
const BTN_GHOST = 'inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap border bg-white text-[#1a2b24] border-[#dfe3db] hover:bg-[#f9faf8] disabled:opacity-50';

// coverage / confidence badge tones from the design's badge palette
const covBadge = (s?: string) =>
  s === 'full' ? 'text-[#0f7a5c] bg-[#e7f6ee] border-[#c3ead2]'
  : s === 'partial' ? 'text-[#a86a12] bg-[#fdf3e3] border-[#f0dcae]'
  : 'text-[#5c6b62] bg-[#f0f2ee] border-[#e0e4dc]';

// Confidence-tier chrome for the mapping recommender. Literal class strings so
// Tailwind's JIT keeps them (dynamic interpolation would be purged).
const BAND: Record<'high' | 'medium' | 'low', { headerBg: string; pill: string }> = {
  high:   { headerBg: 'bg-[#e7f6ee]', pill: 'text-[#0f7a5c] bg-[#d7efe1] border border-[#c3ead2]' },
  medium: { headerBg: 'bg-[#fdf3e3]', pill: 'text-[#a86a12] bg-[#f8e6c8] border border-[#f0dcae]' },
  low:    { headerBg: 'bg-[#f0f2ee]', pill: 'text-[#5c6b62] bg-[#e6e9e2] border border-[#e0e4dc]' },
};

/* ─── residual bands (higher = worse; thresholds match backend RISK_BANDS) ─ */
const bandTone = (score: number) =>
  score >= 75 ? { fg: '#7A2D17', bg: '#F7E4DC', label: 'severe' }
  : score >= 50 ? { fg: '#8A4A0F', bg: '#F6E8D4', label: 'elevated' }
  : score >= 25 ? { fg: '#6E5410', bg: '#F4ECD2', label: 'watch' }
  : { fg: '#0E5A46', bg: '#E2EDE8', label: 'contained' };

const DIMS: { key: string; concept: string; dim: string; guideId: string; guideN: number }[] = [
  { key: 'cia',  concept: 'Impact',        dim: 'CIA ratings', guideId: 'asset.cia', guideN: 2 },
  { key: 'vuln', concept: 'Likelihood',    dim: 'Open vulnerabilities', guideId: 'posture.vulnDimension', guideN: 3 },
  { key: 'ctrl', concept: 'Control gap',   dim: 'Controls not covering this asset', guideId: 'asset.controlCoverage', guideN: 4 },
  { key: 'cis',  concept: 'Hardening gap', dim: 'CIS benchmark failures', guideId: 'asset.cisGap', guideN: 5 },
  { key: 'risk', concept: 'Risk register', dim: 'Linked risks', guideId: 'asset.linkedRisks', guideN: 6 },
];

const CIA_LABELS = ['—', 'Low', 'Low-Med', 'Medium', 'High', 'Critical'];

/* ─── shared card shell ────────────────────────────────────────────────── */

function BigCard({
  icon, title, guide, subtitle, right, children,
}: { icon: React.ReactNode; title: string; guide?: React.ReactNode; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#eceee8]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[#8a948b]">{icon}</span>
            <span className="text-[15px] font-extrabold tracking-[-0.01em] text-[#1a2b24]">{title}</span>
            {guide}
          </div>
          {subtitle && <div className="text-[11.5px] text-[#aab2a8] mt-px">{subtitle}</div>}
        </div>
        {right}
      </div>
      <div className="px-5 py-[18px]">{children}</div>
    </div>
  );
}

/* ─── residual-risk dimension bar ──────────────────────────────────────── */

function DimBar({ label, sub, pct, known, tone, guideId, guideN, weightPct }: { label: string; sub: string; pct: number; known: boolean; tone: string; guideId?: string; guideN?: number; weightPct?: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-52 flex-none">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#1a2b24]">
          {label}
          {weightPct != null && (
            <span className="rounded bg-[#eef1ec] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[#5c6b62]">{weightPct}%</span>
          )}
          {guideId && guideN != null && <GuideMarker id={guideId} n={guideN} />}
        </div>
        <div className="text-[11px] text-[#aab2a8]">{sub}</div>
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef1ec]">
        {known && <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: tone }} />}
      </div>
      <div className={'w-16 flex-none text-right text-[12.5px] font-semibold tabular-nums text-[#1a2b24] ' + MONO}>
        {known ? Math.round(pct) : <span className="text-[#c6ccc2]">—</span>}
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
            : c?.pass_rate != null ? `${c.pass_rate}% of checks pass` : null,
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
      subtitle={isEasm ? 'Likelihood × impact: hygiene (one factor) + exploitability + exposure + business context. Not 100 minus health.' : undefined}
      right={
        <Link href={`/risk-posture/asset/${assetId}`} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0d5c48] hover:underline whitespace-nowrap">
          Full posture <ArrowRight size={12} />
        </Link>
      }
    >
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-[#aab2a8]"><Loader2 size={14} className="animate-spin" /> Computing risk…</div>
      ) : !d ? (
        <div className="py-6 text-[13px] text-[#aab2a8]">Risk posture is unavailable for this asset.</div>
      ) : score == null || !tone ? (
        <div className="py-6 text-[13px] text-[#8a948b]">
          No risk score yet — this asset hasn’t been assessed. Add CIA ratings, link controls or risks, or run a CIS scan to compute its residual risk.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[34px] font-semibold leading-none" style={{ color: tone.fg }}>{Math.round(score)}</span>
            <span className="text-[13px] text-[#aab2a8]">/ 100</span>
            <span className="rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wider" style={{ color: tone.fg, background: tone.bg }}>
              {d.band?.label ?? tone.label} risk
            </span>
            {asset?.internet_facing && <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#b42318] bg-[#fdeceb]">exposed</span>}
            {(asset?.criticality || '').toLowerCase() === 'critical' && <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#b42318] bg-[#fdeceb]">critical</span>}
          </div>

          <div className="mt-5 space-y-2.5">
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

          <div className="mt-4 flex items-center justify-between border-t border-[#f2f4ef] pt-3 text-[12px] text-[#8a948b]">
            <span>Weighted composite of {total} signals · higher = more risk.</span>
            <span className={'flex items-center gap-1.5 ' + (knownCount < total ? 'text-[#a86a12]' : '')}>
              {knownCount} of {total} signals known{d.data_quality != null ? ` · ${Math.round(d.data_quality)}% data quality` : ''}
              {!isEasm && <GuideMarker id="posture.dataQuality" n={7} />}
            </span>
          </div>
          {isEasm && cve && (
            <p className="mt-3 rounded-lg border border-[#f0dcae] bg-[#fdf8ee] px-3 py-2 text-[11.5px] leading-relaxed text-[#5c4a1a]">
              <b>How CVEs are detected:</b> {cve.limits || 'Banner → CPE heuristic plus findings already linked to this host. Not an active exploit test.'}
              {cve.banner_cpe ? ` Banner CPE: ${cve.banner_cpe}.` : ''}
              {` Linked findings: ${cve.linked_findings ?? 0}${cve.kev_findings ? ` · KEV: ${cve.kev_findings}` : ''}.`}
            </p>
          )}
          {knownCount < total && (
            <p className="mt-1 text-[11.5px] text-[#aab2a8]">
              Unknown signals (no data yet) are excluded from the score rather than counted as zero, so the number isn’t artificially low.
            </p>
          )}
        </>
      )}
    </BigCard>
  );
  if (isEasm) {
    return <div className="rounded-2xl border-2 border-[#8A4A0F] bg-[#FBF6EE] p-0.5">{card}</div>;
  }
  return card;
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
      <span className="w-32 flex-none text-[13px] text-[#3a4a42]">{label}</span>
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => { set(n); setDirty(true); }}
            title={CIA_LABELS[n]}
            className="h-6 flex-1 rounded transition-colors"
            style={{ background: n <= value ? (value >= 4 ? '#C2542E' : value === 3 ? '#C79A2A' : '#B08420') : '#EDECE4' }}
          />
        ))}
      </div>
      <span className="w-16 flex-none text-right text-[12px] font-semibold text-[#3a4a42]">{value ? CIA_LABELS[value] : '—'}</span>
    </div>
  );

  return (
    <BigCard
      icon={<Lock size={15} />}
      title="CIA Impact Ratings"
      guide={<GuideMarker id="asset.cia" n={8} />}
      right={
        <span className="rounded-full bg-[#f0f2ee] border border-[#e0e4dc] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#5c6b62] whitespace-nowrap">
          {asset.criticality_manual_override ? 'manual override' : 'auto-derived'}
        </span>
      }
    >
      <Row label="Confidentiality" value={c} set={setC} />
      <Row label="Integrity" value={i} set={setI} />
      <Row label="Availability" value={a} set={setA} />

      {rationale && (
        <p className="mt-3 rounded-lg bg-[#eef4f1] border border-[#d7e6de] px-3 py-2 text-[12px] leading-relaxed text-[#134a3a]">
          <b>AI:</b> {rationale}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#f2f4ef] pt-3">
        <button onClick={() => suggest.mutate()} disabled={suggest.isPending} className={BTN_GHOST}>
          {suggest.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI suggest
        </button>
        <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className={BTN_PRIMARY}>
          {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Save &amp; recalculate
        </button>
        {save.isSuccess && !dirty && <span className="text-[12px] text-[#0f7a5c]">Saved — risk recalculated.</span>}
      </div>
      <p className="mt-2 text-[11px] text-[#aab2a8]">
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
      subtitle={'Continuously monitored · feeds the “Hardening gap” signal above.'}
      right={onOpenCompliance ? (
        <button onClick={onOpenCompliance} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0d5c48] hover:underline whitespace-nowrap">
          Full scans <ArrowRight size={12} />
        </button>
      ) : undefined}
    >
      {!cis || !cis.known ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-[#dfe3db] bg-[#fafbf8] px-4 py-3 text-[12.5px] text-[#8a948b]">
          <AlertCircle size={14} className="mt-0.5 flex-none" />
          No CIS benchmark has been scanned against this asset yet. Run a scan from the Compliance tab to populate this.
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-extrabold text-[#1a2b24]">{hardening ?? '—'}</span>
            <span className="text-[13px] text-[#aab2a8]">/ 100 hardening</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
            <span className="text-[#0f7a5c]"><b>{cis.passed ?? 0}</b> pass</span>
            <span className="text-[#b42318]"><b>{cis.failed ?? 0}</b> fail</span>
            {cis.total != null && <span className="text-[#8a948b]">of {cis.total} checks</span>}
            {cis.ip_group_augmented && <span className="text-[#aab2a8]">· blended with co-located assets</span>}
          </div>
        </>
      )}
    </BigCard>
  );
}

/* ─── Manage: Linked Controls (props-driven, was ControlsTab) ──────────── */

type CtrlLink = { id: number; code?: string; internal_control_id?: number; name: string; category?: string; coverage_status?: string };

function ControlsSection({
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
  const totalControls =
    (asset.linked_controls?.length || 0) +
    (asset.linked_internal_controls?.length || 0) +
    (asset.linked_framework_controls?.length || 0);

  const all: CtrlLink[] = [...(asset.linked_internal_controls || []), ...(asset.linked_framework_controls || []), ...(asset.linked_controls || [])];
  const fullCount = all.filter((c) => c.coverage_status === 'full').length;
  const partialCount = all.filter((c) => c.coverage_status === 'partial').length;

  const Row = ({ icon, code, name, category, status, onUnlink, disabled }: { icon: React.ReactNode; code?: string; name: string; category?: string; status?: string; onUnlink?: () => void; disabled?: boolean }) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#eceee8] bg-[#fafbf8] px-3.5 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[#0d5c48] flex-none">{icon}</span>
        <div className="min-w-0">
          {code && <span className={'text-[11px] font-bold text-[#0d5c48] ' + MONO}>{code}</span>}
          <p className="text-[13px] font-semibold text-[#1a2b24] break-words">{name}</p>
          {category && <span className="text-[11px] text-[#8a948b]">{category}</span>}
        </div>
        {status !== undefined && (
          <span className={`rounded-md border px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${covBadge(status)}`}>
            {status || 'Not set'}
          </span>
        )}
      </div>
      {onUnlink && (
        <button onClick={onUnlink} disabled={disabled} className="rounded p-1 text-[#97a19a] hover:text-[#b42318] disabled:opacity-50 flex-none" title="Unlink Control">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* coverage summary + link CTA */}
      <div className="rounded-2xl border border-[#e6e9e3] bg-[#f4f7f3] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="flex items-center gap-2 text-[15px] font-extrabold text-[#1a2b24]">
              <Shield className="h-5 w-5 text-[#0d5c48]" />
              Linked Controls
              <span className="rounded-full bg-[#e7f6ee] border border-[#c3ead2] px-2 py-0.5 text-[11px] font-bold text-[#0f7a5c]">{totalControls}</span>
            </h3>
            <p className="mt-1 text-[12px] text-[#5c6b62]">
              Controls applied to this asset across Internal Controls, Framework Controls, and the Normalized
              Control Library. Linking more controls reduces this asset’s contribution to the tenant’s risk score.
            </p>
          </div>
          <InlineLinkPicker
            triggerLabel="+ Link Control"
            items={controlPickerItems}
            isLoading={controlsLoading || isLinkingControl}
            emptyText="No controls available"
            searchPlaceholder="Search controls"
            onSelect={(value) => onLinkControl(Number(value))}
          />
        </div>

        {totalControls > 0 && (
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-[#5c6b62]">
            {fullCount > 0 && <span><span className="inline-block h-2 w-2 rounded-full bg-[#0f9d78] mr-1 align-middle" />{fullCount} fully covered</span>}
            {partialCount > 0 && <span><span className="inline-block h-2 w-2 rounded-full bg-[#d9a441] mr-1 align-middle" />{partialCount} partial</span>}
            {totalControls > fullCount + partialCount && (
              <span><span className="inline-block h-2 w-2 rounded-full bg-[#aab2a8] mr-1 align-middle" />{totalControls - fullCount - partialCount} not rated</span>
            )}
          </div>
        )}
      </div>

      {asset.linked_internal_controls && asset.linked_internal_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b]">Risk Management Internal Controls</h4>
          <div className="space-y-2">
            {asset.linked_internal_controls.map((control) => (
              <Row
                key={control.id}
                icon={<ShieldCheck className="h-5 w-5" />}
                code={control.code || `IC-${control.internal_control_id}`}
                name={control.name}
                category={control.category}
                status={control.coverage_status}
                onUnlink={() => onUnlinkInternalControl(control.id)}
                disabled={isUnlinkingInternal}
              />
            ))}
          </div>
        </div>
      )}

      {asset.linked_framework_controls && asset.linked_framework_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b]">Framework Controls</h4>
          <div className="space-y-2">
            {asset.linked_framework_controls.map((control) => (
              <Row
                key={control.id}
                icon={<Shield className="h-5 w-5" />}
                code={control.code}
                name={control.name}
                status={control.coverage_status}
                onUnlink={() => onUnlinkFrameworkControl(control.id)}
                disabled={isUnlinkingFramework}
              />
            ))}
          </div>
        </div>
      )}

      {asset.linked_controls && asset.linked_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b]">Legacy Normalized Controls</h4>
          <div className="space-y-2">
            {asset.linked_controls.map((control) => (
              <Row key={control.id} icon={<ShieldCheck className="h-5 w-5" />} code={control.code} name={control.name} />
            ))}
          </div>
        </div>
      )}

      {totalControls === 0 && (
        <p className="rounded-lg border border-dashed border-[#dfe3db] bg-[#fafbf8] px-4 py-3 text-[12.5px] text-[#8a948b]">
          No controls linked yet — this dimension is treated as unmeasured and left out of the score.
          Use <span className="font-semibold text-[#1a2b24]">+ Link Control</span> above to start scoring it.
        </p>
      )}
    </div>
  );
}

/* ─── Manage: Associated Risks (props-driven, was RisksTab) ────────────── */

function RisksSection({ asset }: { asset: RisksPanelAsset }) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-[15px] font-extrabold text-[#1a2b24]">
        <AlertTriangle className="h-5 w-5 text-[#0d5c48]" />
        Associated Risks
        <span className="rounded-full bg-[#f0f2ee] border border-[#e0e4dc] px-2 py-0.5 text-[11px] font-bold text-[#5c6b62]">{asset.linked_risks?.length || 0}</span>
      </h3>

      {asset.linked_risks && asset.linked_risks.length > 0 ? (
        <div className="space-y-2">
          {asset.linked_risks.map((risk) => (
            <div key={risk.risk_id} className="flex items-center justify-between gap-3 rounded-xl border border-[#eceee8] bg-[#fafbf8] px-3.5 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <AlertTriangle className="h-5 w-5 text-[#d9a441] flex-none" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[#1a2b24] break-words">{risk.title || `Risk #${risk.risk_id}`}</p>
                  <p className="text-[11px] text-[#8a948b]">Risk ID: {risk.risk_id}{risk.status ? ` • ${risk.status}` : ''}</p>
                </div>
              </div>
              <Link href={`/erm/risks/${risk.risk_id}`} className="text-[12.5px] font-semibold text-[#0d5c48] hover:underline whitespace-nowrap">
                View Details
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[#dfe3db] bg-[#fafbf8] px-4 py-3 text-[12.5px] text-[#8a948b]">
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
      <div className="flex items-center justify-center rounded-2xl border border-[#e6e9e3] bg-white py-12">
        <PageLoader size="sm" />
      </div>
    );
  }
  if (recsQuery.error) {
    return (
      <div className="rounded-lg border border-[#f3cfcb] bg-[#fdf1f0] p-4 text-[13px] text-[#b42318]">
        Failed to load mapping recommendations.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {bannerMessage && (
        <div className="flex items-center justify-between rounded-lg border border-[#c3ead2] bg-[#e7f6ee] px-3 py-2 text-[13px] text-[#0f6b4f]">
          <span>{bannerMessage}</span>
          <button type="button" onClick={() => setBannerMessage(null)} className="text-[#0f7a5c] hover:text-[#0d5c48]" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <h3 className="flex items-center gap-2 text-[15px] font-extrabold text-[#1a2b24]">
        <Sparkles className="h-4 w-4 text-[#d9a441]" />
        Auto-suggested framework controls
      </h3>

      <div className="rounded-2xl border border-[#e6e9e3] bg-[#f4f7f3] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-[#3a4a42]">
            <Filter className="h-3.5 w-3.5 text-[#8a948b]" />
            Framework
            <select
              value={frameworkFilter}
              onChange={(e) => setFrameworkFilter(e.target.value === '' ? '' : Number(e.target.value))}
              className="rounded-lg border border-[#dfe3db] bg-white px-2 py-1 text-[12px] text-[#1a2b24] focus:border-[#0d5c48] focus:outline-none"
            >
              <option value="">All</option>
              {frameworkOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[#3a4a42]">
            Min score
            <input type="range" min={1} max={12} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="h-1 w-32 accent-[#0d5c48]" />
            <span className="w-6 text-center font-semibold text-[#1a2b24]">{minScore}</span>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[#3a4a42]">
            <input type="checkbox" checked={includeLinked} onChange={(e) => setIncludeLinked(e.target.checked)} className="h-3.5 w-3.5 rounded border-[#dfe3db] text-[#0d5c48] focus:ring-[#0d5c48]" />
            Include already-linked
          </label>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-[#3a4a42]">
              Link as
              <select
                value={coverageStatus}
                onChange={(e) => setCoverageStatus(e.target.value as 'partial' | 'full' | 'minimal')}
                className="rounded-lg border border-[#dfe3db] bg-white px-2 py-1 text-[12px] text-[#1a2b24] focus:border-[#0d5c48] focus:outline-none"
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
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#dfe3db] bg-[#fafbf8] py-10 px-4 text-center">
          <ShieldCheck className="mb-3 h-10 w-10 text-[#c6ccc2]" />
          <h4 className="text-[15px] font-semibold text-[#1a2b24]">No recommendations</h4>
        </div>
      ) : (
        (['high', 'medium', 'low'] as const).map((band) => {
          const list = groups[band];
          if (list.length === 0) return null;
          const cls = BAND[band];
          return (
            <div key={band} className="overflow-hidden rounded-2xl border border-[#e6e9e3] bg-white">
              <div className={`flex items-center justify-between border-b border-[#eceee8] ${cls.headerBg} px-3 py-2`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold capitalize ${cls.pill}`}>
                    {band} confidence
                  </span>
                  <span className="text-[12px] text-[#5c6b62]">{list.length} control{list.length === 1 ? '' : 's'}</span>
                </div>
                <button type="button" onClick={() => selectAllOfConfidence(band)} className="text-[12px] font-semibold text-[#0d5c48] hover:underline">
                  Select all
                </button>
              </div>
              <ul className="divide-y divide-[#f2f4ef]">
                {list.map((r) => {
                  const isSelected = selectedIds.has(r.framework_control_id);
                  const isExpanded = expandedId === r.framework_control_id;
                  return (
                    <li key={r.framework_control_id} className={isSelected ? 'bg-[#eef4f1]' : ''}>
                      <div className="flex items-start gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(r.framework_control_id)}
                          className="mt-1 h-4 w-4 rounded border-[#dfe3db] text-[#0d5c48] focus:ring-[#0d5c48]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={'rounded bg-[#f0f2ee] px-1.5 py-0.5 text-[11px] text-[#3a4a42] ' + MONO}>{r.code}</span>
                            <span className="text-[13px] font-semibold text-[#1a2b24]">{r.name}</span>
                            {r.framework_short_code && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#e0e4dc] px-2 py-0.5 text-[11px] text-[#5c6b62]">
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
                              <span key={s.key} title={`+${s.weight}`} className="inline-flex items-center rounded-full bg-[#e7f6ee] px-2 py-0.5 text-[11px] text-[#0f6b4f]">
                                {s.label}
                              </span>
                            ))}
                            {r.negative_notes.map((n, i) => (
                              <span key={`n-${i}`} className="inline-flex items-center rounded-full bg-[#fdeceb] px-2 py-0.5 text-[11px] text-[#b42318]">
                                {n}
                              </span>
                            ))}
                          </div>
                          {isExpanded && r.statement && (
                            <p className="mt-2 rounded-md bg-[#fafbf8] border border-[#eceee8] p-2 text-[12px] leading-relaxed text-[#3a4a42]">
                              {r.statement}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : r.framework_control_id)}
                            className="rounded p-1 text-[#97a19a] hover:bg-[#f0f2ee] hover:text-[#3a4a42]"
                            title={isExpanded ? 'Collapse' : 'Show statement'}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            disabled={acceptMutation.isPending}
                            onClick={() => acceptOne(r.framework_control_id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#dfe3db] bg-white px-2 py-1 text-[12px] text-[#3a4a42] hover:bg-[#f9faf8] disabled:opacity-50"
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
    <div className="space-y-4 font-['Public_Sans',system-ui,sans-serif] text-[#1a2b24]">
      {isExternal && (
        <div className="rounded-xl border border-[#1d4e89] bg-[#e8f1fa] px-4 py-3">
          <div className="text-[11px] font-extrabold tracking-[0.08em] uppercase text-[#1d4e89]">Public attack surface</div>
          <p className="mt-0.5 text-[12.5px] text-[#3a5470]">
            This host was found from the internet. This tab shows its compromise risk. The configuration-hygiene score and its per-parameter breakdown live on the <b>Overview</b> tab — click the hygiene card there. Internal CIA / CIS scores do not apply.
          </p>
        </div>
      )}
      <ResidualRiskCard assetId={assetId} asset={asset} />
      {!isExternal && (
        <div className="grid gap-4 lg:grid-cols-2">
          <CIACard assetId={assetId} asset={asset} />
          <CISCard assetId={assetId} onOpenCompliance={onOpenCompliance} />
        </div>
      )}

      {/* Below the fold: management the reference cannot do — link controls and
          risks, accept mapping suggestions. Subordinate, never restates a
          headline number the cards above already show. */}
      <div className="mt-6 border-t-2 border-[#e6e9e3] pt-5">
        <div className="mb-4">
          <div className="text-[11px] font-extrabold tracking-[0.07em] uppercase text-[#5c6b62]">Manage</div>
          <p className="mt-0.5 text-[12.5px] text-[#aab2a8]">What feeds the scores above — link controls and risks to this asset.</p>
        </div>
        <div className="space-y-6">
          <ControlsSection
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
          <RisksSection asset={asset} />
          <MappingRecommendationsSection assetId={assetId} />
        </div>
      </div>
    </div>
  );
}
