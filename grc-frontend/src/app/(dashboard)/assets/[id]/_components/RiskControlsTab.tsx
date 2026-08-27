'use client';

/**
 * Asset "Risk & Controls" tab — three cards, matching Command Center's layout,
 * but driven entirely by OUR single source of truth.
 *
 * The headline residual score and its bars come from ONE place:
 * `GET /risk-posture/asset/{id}` → `compute_asset_risk`. This is the same
 * number the standalone Risk Posture page shows; it is NOT recomputed here.
 * That is the whole point — the value appears once, from one backend function,
 * so the asset page and the posture page can never disagree.
 *
 * Command Center models residual as "(Likelihood × Impact) reduced by control
 * effectiveness". Ours is a weighted composite of five dimensions. We keep our
 * model (the user asked to) and label the bars honestly with both the concept
 * and the dimension behind it.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gauge, Lock, Cpu, Sparkles, ArrowRight, ShieldCheck, AlertCircle, Loader2,
} from 'lucide-react';
import { assetsApi, riskPostureApi } from '@/lib/api';
import { GuideMarker } from '@/components/guide';

/* ─── residual bands (higher score = worse, matching the backend) ──────── */
// Thresholds and words match the backend's RISK_BANDS exactly (75/50/25), and
// deliberately avoid the criticality vocabulary so "severe risk" can never be
// mistaken for "critical asset".
const bandTone = (score: number) =>
  score >= 75 ? { fg: '#7A2D17', bg: '#F7E4DC', label: 'severe' }
  : score >= 50 ? { fg: '#8A4A0F', bg: '#F6E8D4', label: 'elevated' }
  : score >= 25 ? { fg: '#6E5410', bg: '#F4ECD2', label: 'watch' }
  : { fg: '#0E5A46', bg: '#E2EDE8', label: 'contained' };

/** Our five dimensions.
 *
 * IMPORTANT: every one of these is a RISK CONTRIBUTION — higher means worse.
 * The control and CIS dimensions are GAPS in the backend (`_cis_gap`,
 * `score = 1 - coverage`), so they must NOT be labelled "effectiveness" or
 * "hardening": those read as higher-is-better and invert the meaning. The
 * positive figure (how much IS covered / passing) is shown beside each bar so
 * both readings are available without the label lying about direction.
 */
const DIMS: { key: string; concept: string; dim: string; guideId: string; guideN: number }[] = [
  { key: 'cia',  concept: 'Impact',        dim: 'CIA ratings', guideId: 'asset.cia', guideN: 2 },
  { key: 'vuln', concept: 'Likelihood',    dim: 'Open vulnerabilities', guideId: 'posture.vulnDimension', guideN: 3 },
  { key: 'ctrl', concept: 'Control gap',   dim: 'Controls not covering this asset', guideId: 'asset.controlCoverage', guideN: 4 },
  { key: 'cis',  concept: 'Hardening gap', dim: 'CIS benchmark failures', guideId: 'asset.cisGap', guideN: 5 },
  { key: 'risk', concept: 'Risk register', dim: 'Linked risks', guideId: 'asset.linkedRisks', guideN: 6 },
];

function Bar({ label, sub, pct, known, tone, guideId, guideN }: { label: string; sub: string; pct: number; known: boolean; tone: string; guideId?: string; guideN?: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-44 flex-none">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          {label}
          {guideId && guideN != null && <GuideMarker id={guideId} n={guideN} />}
        </div>
        <div className="text-[11px] text-slate-400">{sub}</div>
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        {known && <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: tone }} />}
      </div>
      <div className="w-16 flex-none text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-900">
        {known ? Math.round(pct) : <span className="text-slate-300">—</span>}
      </div>
    </div>
  );
}

/* ─── Card 1: Residual Risk (the single source) ───────────────────────── */

function ResidualRiskCard({ assetId, asset }: { assetId: number; asset: any }) {
  const q = useQuery({
    queryKey: ['asset-risk-posture', assetId],
    queryFn: async () => (await riskPostureApi.asset(assetId)).data as any,
  });
  const d = q.data;
  const score = d?.score ?? null;
  const tone = score != null ? bandTone(score) : null;
  const isEasm = d?.mode === 'easm';
  // External (EASM) assets return exposure dimensions (tls/headers/transport/
  // email/vuln) with their own labels; internal assets use the fixed 5 signals.
  // Build one row list from whichever the posture returned so the bars match the
  // model — and can never disagree with the Full-posture page.
  const rows: { key: string; concept: string; dim: string; pct: number; known: boolean; positive: string | null; guideId?: string; guideN?: number }[] = isEasm
    ? Object.entries(d.components || {}).map(([key, c]: [string, any]) => ({
        key, concept: c.label || key, dim: c.detail || '', pct: (c.score ?? 0) * 100, known: true, positive: null,
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

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <Gauge size={15} className="text-slate-500" />
        <h3 className="text-[15px] font-semibold text-slate-900">Residual Risk</h3>
        <GuideMarker id="asset.residualRisk" n={1} />
        <Link href={`/risk-posture/asset/${assetId}`} className="ml-auto flex items-center gap-1 text-[12.5px] font-semibold text-teal-700 hover:underline">
          Full posture <ArrowRight size={12} />
        </Link>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-slate-400"><Loader2 size={14} className="animate-spin" /> Computing risk…</div>
      ) : !d ? (
        <div className="py-6 text-[13px] text-slate-400">Risk posture is unavailable for this asset.</div>
      ) : score == null || !tone ? (
        // An unassessed / unprofiled asset has no computed score, so there is no
        // band/tone. Render a prompt instead of dereferencing tone!.fg (which
        // crashed the whole tab with "Cannot read properties of null").
        <div className="py-6 text-[13px] text-slate-400">
          No risk score yet — this asset hasn’t been assessed. Add CIA ratings, link controls or risks, or run a CIS scan to compute its residual risk.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[34px] font-semibold leading-none" style={{ color: tone!.fg }}>{Math.round(score!)}</span>
            <span className="text-[13px] text-slate-400">/ 100</span>
            <span className="rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wider" style={{ color: tone!.fg, background: tone!.bg }}>
              {d.band?.label ?? tone!.label} risk
            </span>
            {asset?.internet_facing && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">exposed</span>}
            {(asset?.criticality || '').toLowerCase() === 'critical' && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">critical</span>}
          </div>

          <div className="mt-5 space-y-2.5">
            {rows.map((r) => (
              <Bar
                key={r.key}
                label={r.concept}
                sub={r.positive ? `${r.dim} · ${r.positive}` : r.dim}
                pct={r.pct}
                known={r.known}
                tone={tone!.fg}
                guideId={r.guideId}
                guideN={r.guideN}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[12px] text-slate-500">
            <span>Weighted composite of {total} signals · higher = more risk.</span>
            <span className={'flex items-center gap-1.5 ' + (knownCount < total ? 'text-amber-700' : '')}>
              {knownCount} of {total} signals known{d.data_quality != null ? ` · ${Math.round(d.data_quality)}% data quality` : ''}
              <GuideMarker id="posture.dataQuality" n={7} />
            </span>
          </div>
          {knownCount < total && (
            <p className="mt-1 text-[11.5px] text-slate-400">
              Unknown signals (no data yet) are excluded from the score rather than counted as zero, so the number isn't artificially low.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Card 2: CIA Impact Ratings (editable, single home) ──────────────── */

const CIA_LABELS = ['—', 'Low', 'Low-Med', 'Medium', 'High', 'Critical'];

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
  }, [asset.id]);

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
      // Saving recomputes derived criticality on the backend and re-scores
      // risk — invalidate both so the Residual card and header refresh.
      qc.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      qc.invalidateQueries({ queryKey: ['asset', assetId] });
      qc.invalidateQueries({ queryKey: ['asset-risk-posture', assetId] });
      setDirty(false); setRationale(null);
    },
  });

  const Row = ({ label, value, set }: { label: string; value: number; set: (n: number) => void }) => (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-32 flex-none text-[13px] text-slate-700">{label}</span>
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
      <span className="w-16 flex-none text-right text-[12px] font-semibold text-slate-700">{value ? CIA_LABELS[value] : '—'}</span>
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Lock size={15} className="text-slate-500" />
        <h3 className="text-[15px] font-semibold text-slate-900">CIA Impact Ratings</h3>
        <GuideMarker id="asset.cia" n={8} />
        {asset.criticality_manual_override
          ? <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">manual override</span>
          : <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">auto-derived</span>}
      </div>

      <Row label="Confidentiality" value={c} set={setC} />
      <Row label="Integrity" value={i} set={setI} />
      <Row label="Availability" value={a} set={setA} />

      {rationale && (
        <p className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-[12px] leading-relaxed text-indigo-900">
          <b>AI:</b> {rationale}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        <button onClick={() => suggest.mutate()} disabled={suggest.isPending}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {suggest.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI suggest
        </button>
        <button onClick={() => save.mutate()} disabled={!dirty || save.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-teal-600 disabled:opacity-40">
          {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Save &amp; recalculate
        </button>
        {save.isSuccess && !dirty && <span className="text-[12px] text-emerald-700">Saved — risk recalculated.</span>}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Saving updates the asset's derived criticality and re-scores its risk. CIA is edited here only — the one place it lives.
      </p>
    </div>
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
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <Cpu size={15} className="text-slate-500" />
        <h3 className="text-[15px] font-semibold text-slate-900">CIS Benchmark Compliance</h3>
        <GuideMarker id="asset.cisGap" n={9} />
        {onOpenCompliance && (
          <button onClick={onOpenCompliance} className="ml-auto flex items-center gap-1 text-[12.5px] font-semibold text-teal-700 hover:underline">
            Full scans <ArrowRight size={12} />
          </button>
        )}
      </div>
      <p className="mb-4 text-[12px] text-slate-500">Continuously monitored · feeds the "Hardening gap" signal above.</p>

      {!cis || !cis.known ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-[12.5px] text-slate-500">
          <AlertCircle size={14} className="mt-0.5 flex-none" />
          No CIS benchmark has been scanned against this asset yet. Run a scan from the Compliance tab to populate this.
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-semibold text-slate-900">{hardening ?? '—'}</span>
            <span className="text-[13px] text-slate-400">/ 100 hardening</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
            <span className="text-emerald-700"><b>{cis.passed ?? 0}</b> pass</span>
            <span className="text-rose-700"><b>{cis.failed ?? 0}</b> fail</span>
            {cis.total != null && <span className="text-slate-500">of {cis.total} checks</span>}
            {cis.ip_group_augmented && <span className="text-slate-400">· blended with co-located assets</span>}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── the tab ─────────────────────────────────────────────────────────── */

export default function RiskControlsTab({
  assetId, asset, onOpenCompliance, children,
}: { assetId: number; asset: any; onOpenCompliance?: () => void; children?: React.ReactNode }) {
  // External (EASM) assets have no CIA ratings and no CIS baseline — those two
  // editable cards don't apply; the Residual Risk card already shows the
  // exposure dimensions that DO.
  const isExternal = !!(asset?.platform_properties?.external_probe) || asset?.last_seen_source === 'external';
  return (
    <div className="space-y-4">
      <ResidualRiskCard assetId={assetId} asset={asset} />
      {!isExternal && (
        <div className="grid gap-4 lg:grid-cols-2">
          <CIACard assetId={assetId} asset={asset} />
          <CISCard assetId={assetId} onOpenCompliance={onOpenCompliance} />
        </div>
      )}
      {/* The three cards above ARE the page — they mirror the reference
          product exactly. Everything below is management the reference simply
          cannot do (it can only READ a control-effectiveness number; it cannot
          link a control or a risk). Kept, but clearly subordinate, and it must
          never restate a number the cards above already show. */}
      {children && (
        <div style={{ marginTop: 26, paddingTop: 18, borderTop: '2px solid var(--as-border)' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--as-muted)' }}>
              Manage
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--as-faint)', marginTop: 3 }}>
              What feeds the scores above — link controls and risks to this asset.
            </p>
          </div>
          <div className="space-y-4">{children}</div>
        </div>
      )}
    </div>
  );
}
