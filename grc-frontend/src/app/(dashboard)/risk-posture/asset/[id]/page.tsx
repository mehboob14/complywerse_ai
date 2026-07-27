'use client';
export const dynamic = 'force-dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assetsApi, riskPostureApi } from '@/lib/api';
import { ShieldAlert, ChevronRight, X, SlidersHorizontal, ArrowLeft } from 'lucide-react';
import { GuideMarker } from '@/components/guide';

type Posture = {
  asset: {
    id: number;
    name: string;
    host_name?: string | null;
    ip_address?: string | null;
    asset_type?: string | null;
    criticality?: string | null;
    owner_name?: string | null;
  };
  score: number | null;
  band: { label: string; description: string };
  weights: { cis: number; vuln: number; cia: number; ctrl: number; risk: number };
  data_quality: number;
  known_dimensions: string[];
  components: {
    cis: { score: number; known: boolean; passed: number; failed: number; never_scanned?: number; total: number; pass_rate: number | null };
    vuln: {
      score: number; known: boolean; raw_points: number; open_count: number; active_count: number; total_linked: number;
      by_severity: Record<string, number>; by_status: Record<string, number>;
      effective_risk?: {
        method: string;
        best_score: number;
        best_contributions?: Record<string, number>;
        best_reason?: string;
        per_vuln: Array<{
          vuln_id: number;
          cve_id?: string | null;
          title?: string | null;
          severity?: string | null;
          cvss_score?: number | null;
          epss_score?: number | null;
          kev_flag?: boolean;
          score: number;
          band: string;
          escalated: boolean;
          contributions: Record<string, number>;
          business_impact_factor: number;
          reason: string;
        }>;
      };
    };
    cia: { score: number; known: boolean; confidentiality: number | null; integrity: number | null; availability: number | null; missing: boolean };
    ctrl: { score: number; known: boolean; coverage_pct: number; linked_count: number; target: number };
    risk: { score: number; known: boolean; open_count: number; active_count: number; total_linked: number; raw_points: number; by_status: Record<string, number> };
  };
  contributions: { cis: number; vuln: number; cia: number; ctrl: number; risk: number };
};

// One per-vulnerability row in the effective_risk payload. Shared between
// the main component (which decides whether to use the saved-state or the
// preview-state list) and the TriagedVulnSection (which renders the cards).
type PerVulnRow = NonNullable<Posture['components']['vuln']['effective_risk']>['per_vuln'][number];

type AssetForBiz = {
  id: number;
  name: string;
  criticality?: string;
  confidentiality_rating?: number | null;
  integrity_rating?: number | null;
  availability_rating?: number | null;
  is_customer_facing?: boolean;
  is_internet_facing?: boolean;
  regulated_data_type?: string;
  operational_dependency?: string;
  business_impact_notes?: string | null;
};

type PreviewResp = {
  before: { score: number; band: { label: string; description?: string } };
  after: { score: number; band: { label: string; description?: string } };
  delta: number;
  before_effective?: { best_score: number; per_vuln: Array<{ vuln_id: number; cve_id?: string | null; score: number; band: string }> };
  after_effective?: { best_score: number; per_vuln: Array<{ vuln_id: number; cve_id?: string | null; score: number; band: string }> };
};

// Sanctioned severity ramp: low=emerald, medium/moderate=amber, high=orange,
// critical=rose — a genuine multi-value scale, preserved semantically.
// Keys MUST match RISK_BANDS in backend/grc/modules/risk_posture/service.py:
// contained / watch / elevated / severe. They were low/moderate/high/critical —
// the band names before the rename — so every lookup missed and every pill on
// this page fell through to the grey "unknown" default. A whole risk colour
// scale silently switched itself off.
const BAND_COLOR: Record<string, string> = {
  contained: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  watch: 'bg-amber-50 text-amber-700 border-amber-200',
  elevated: 'bg-orange-50 text-orange-700 border-orange-200',
  severe: 'bg-rose-50 text-rose-700 border-rose-200',
  unknown: 'bg-slate-100 text-slate-700 border-slate-200',
};

const RING: Record<string, string> = {
  contained: 'text-emerald-600',
  watch: 'text-amber-600',
  elevated: 'text-orange-600',
  severe: 'text-rose-600',
  unknown: 'text-slate-400',
};

// These multipliers MUST match _REGULATED_DATA_MULTIPLIER and
// _OPERATIONAL_DEPENDENCY_MULTIPLIER in
// backend/grc/modules/risk_posture/effective_risk.py. They are duplicated here
// only to label the radio buttons — nothing keeps them in sync, and they had
// already drifted: the backend corrected PII from 1.3 to 1.4 (calling 1.3 "a
// transcription error that under-weighted PII relative to PCI/PHI/Financial")
// while this table kept showing 1.3×. The UI was telling operators a number the
// scorer had stopped using.
const REGULATED_DATA: Array<{ value: string; label: string; mult: string }> = [
  { value: 'none', label: 'None', mult: '1.0×' },
  { value: 'pii', label: 'PII', mult: '1.4×' },
  { value: 'pci', label: 'PCI (cardholder)', mult: '1.4×' },
  { value: 'phi', label: 'PHI (health)', mult: '1.4×' },
  { value: 'financial', label: 'Financial records', mult: '1.4×' },
  { value: 'multiple', label: 'Multiple categories', mult: '1.4×' },
];

const OP_DEP: Array<{ value: string; label: string; mult: string; meaning: string }> = [
  { value: 'low',      label: 'Low',      mult: '0.8×', meaning: 'Can be down for hours/days. Has redundancy or isn\'t business-critical. (dev box, internal wiki, backup)' },
  { value: 'medium',   label: 'Medium',   mult: '1.0×', meaning: 'Important but has workarounds. Downtime causes friction; business keeps running. (internal CRM, IT service desk)' },
  { value: 'high',     label: 'High',     mult: '1.3×', meaning: 'Critical to a major workflow. SLA breaches and measurable revenue loss within hours. (branch network, loan origination)' },
  { value: 'critical', label: 'Critical', mult: '1.5×', meaning: 'The asset IS the business for that line. Downtime stops transactions or breaks regulator commitments. (core banking, primary payment gateway)' },
];

const CRIT_TO_CIA = (c?: string): number => {
  switch ((c || '').toLowerCase()) {
    case 'critical': return 5;
    case 'high': return 4;
    case 'low': return 2;
    default: return 3;
  }
};

const bandPill = (label?: string) =>
  `border ${BAND_COLOR[(label || '').toLowerCase()] || BAND_COLOR.unknown}`;

export default function RiskPostureAssetPage() {
  const params = useParams<{ id: string }>();
  const assetId = params?.id ? Number(params.id) : 0;
  const queryClient = useQueryClient();

  const postureQ = useQuery<Posture>({
    queryKey: ['risk-posture.asset', assetId],
    queryFn: async () => (await riskPostureApi.asset(assetId)).data,
    enabled: assetId > 0,
  });

  const ipPeersQ = useQuery({
    queryKey: ['ip-peers', assetId],
    queryFn: async () => (await assetsApi.getIPPeers(assetId)).data,
    enabled: assetId > 0,
  });

  const assetQ = useQuery<AssetForBiz>({
    queryKey: ['asset-detail', assetId],
    queryFn: async () => (await assetsApi.getDetail(assetId)).data,
    enabled: assetId > 0,
  });

  // Business Context editable state — initialised from assetQ
  const defaultCIA = CRIT_TO_CIA(assetQ.data?.criticality);
  const [form, setForm] = useState({
    is_customer_facing: false,
    is_internet_facing: false,
    regulated_data_type: 'none',
    operational_dependency: 'medium',
    confidentiality_rating: 3,
    integrity_rating: 3,
    availability_rating: 3,
    business_impact_notes: '',
  });

  // Rebuild the form from whatever the server currently holds.
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

  // The dependency list was [assetQ.data?.id, defaultCIA]. After a save the id
  // is unchanged, so this never re-ran and the form kept whatever it held —
  // including the hardcoded initial defaults for any field the user had not
  // touched. Save posts the WHOLE form, so editing one field wrote defaults
  // over every other field: changing operational dependency could silently
  // reset customer-facing and internet-facing. Depend on the values themselves.
  useEffect(() => {
    hydrateForm();
  }, [
    assetQ.data?.id,
    assetQ.data?.is_customer_facing,
    assetQ.data?.is_internet_facing,
    assetQ.data?.regulated_data_type,
    assetQ.data?.operational_dependency,
    assetQ.data?.confidentiality_rating,
    assetQ.data?.integrity_rating,
    assetQ.data?.availability_rating,
    assetQ.data?.business_impact_notes,
    defaultCIA,
    hydrateForm,
  ]);

  const isDirty = useMemo(() => {
    const a = assetQ.data;
    if (!a) return false;
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

  // Live preview (debounced via React Query staleness — request fires per state change but cached)
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
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      queryClient.invalidateQueries({ queryKey: ['risk-posture.asset', assetId] });
      // Key must match page.tsx's ['risk-posture.dashboard'] exactly. It was
      // 'risk-posture-dashboard' (hyphen vs dot), so saving weights invalidated
      // nothing and the dashboard only updated on its next 30s poll — while the
      // toast claimed it would recompute.
      queryClient.invalidateQueries({ queryKey: ['risk-posture.dashboard'] });
    },
  });

  const [openTile, setOpenTile] = useState<null | 'business' | 'vulns'>(null);

  if (postureQ.isLoading || assetQ.isLoading) return <div className="p-6 text-sm text-slate-500">Loading risk breakdown…</div>;
  if (postureQ.isError || !postureQ.data || assetQ.isError || !assetQ.data) {
    return (
      <div className="p-4">
        <Link href="/risk-posture" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Back to Risk Posture
        </Link>
        <div className="mt-4 text-sm text-rose-600">Failed to load asset.</div>
      </div>
    );
  }

  const { asset, score, band, weights, components, contributions, data_quality, known_dimensions } = postureQ.data;
  // Sum of the weights that actually count. Dimensions with no evidence are
  // excluded from the score and the rest renormalised over what remains, so the
  // share the legend shows must be the EFFECTIVE one.
  const effWeight = (['cis', 'vuln', 'cia', 'ctrl', 'risk'] as const)
    .reduce((sum, k) => sum + ((components as any)[k]?.known ? (weights as any)[k] : 0), 0) || 1;
  const bandLabel = band.label;
  // When the operator has unsaved changes AND the preview has come back,
  // use the preview's per-vuln list so the breakdown cards reflect the
  // pending state. Otherwise show the saved state. Without this merge the
  // weighted-base equation on each card stays frozen at the saved values
  // while everything else on the screen recomputes — confusing for the
  // operator who toggled something and expects the math to follow.
  const previewPerVuln = previewQ.data?.after_effective?.per_vuln as PerVulnRow[] | undefined;
  const savedPerVuln = components.vuln?.effective_risk?.per_vuln || [];
  const perVuln: PerVulnRow[] = (isDirty && previewPerVuln && previewPerVuln.length > 0)
    ? previewPerVuln
    : savedPerVuln;

  return (
    <div className="p-4 space-y-4">
      {/* Header — standardized: back arrow + icon chip + identity, score on the right */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <Link
              href="/risk-posture"
              className="mt-0.5 rounded-md p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              title="Back to Risk Posture"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <ShieldAlert className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{asset.asset_type || 'Asset'}</div>
              <h1 className="text-lg font-semibold text-slate-900 truncate">{asset.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {asset.host_name && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{asset.host_name}</span>}
                {asset.ip_address && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{asset.ip_address}</span>}
                {asset.owner_name && <span>Owner: {asset.owner_name}</span>}
                {asset.criticality && <span className="capitalize">Criticality: {asset.criticality}</span>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-baseline justify-end gap-1.5">
              <span className={`text-3xl font-bold ${RING[bandLabel] ?? 'text-slate-900'}`}>{score == null ? '—' : score}</span>
              <span className="text-xs text-slate-500">/ 100</span>
              <GuideMarker id="posture.score" n={1} />
            </div>
            <span className={`mt-1 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium uppercase ${bandPill(bandLabel)}`}>
              {bandLabel}
              <GuideMarker id="posture.bands" n={2} />
            </span>
            <div className="flex items-center justify-end gap-1 text-[10px] text-slate-500 mt-1">
              <span>
                Data quality{' '}
                <strong className={
                  data_quality >= 75 ? 'text-emerald-700'
                  : data_quality >= 50 ? 'text-amber-700'
                  : data_quality >= 25 ? 'text-orange-700' : 'text-rose-700'
                }>{data_quality}%</strong>
                {' '}· {known_dimensions.length}/5
              </span>
              <GuideMarker id="posture.dataQuality" n={3} />
            </div>
          </div>
        </div>
      </div>

      {/* IP Group composite — shown when this asset shares an IP with others */}
      {ipPeersQ.data && ipPeersQ.data.group && ipPeersQ.data.group.length > 1 && (() => {
        const { group, composite } = ipPeersQ.data;
        const effective = composite?.effective_score;
        const hostScore = composite?.host_score;
        const weakest = composite?.weakest;
        // Compliance score scale (higher = better): emerald / amber / rose.
        const scoreColor = (s: number | null | undefined) =>
          s == null ? 'text-slate-400' :
          s >= 80 ? 'text-emerald-700' :
          s >= 60 ? 'text-amber-700' : 'text-rose-700';

        return (
          <div className="rounded-lg border border-primary-200 bg-primary-50/50 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-primary-600 text-[#0a0a0a]">
              <div>
                <div className="text-xs uppercase tracking-wider font-semibold opacity-80">IP Group — {asset.ip_address}</div>
                <div className="text-sm font-semibold">{group.length} assets share this host · composite CIS compliance</div>
              </div>
              {effective != null && (
                <div className="text-right">
                  <div className="text-3xl font-bold">{effective.toFixed(1)}%</div>
                  <div className="text-xs opacity-80">effective · host {hostScore}%</div>
                </div>
              )}
            </div>

            <div className="px-5 py-4">
              {/* Formula explanation */}
              {composite && (
                <div className="mb-3 text-xs text-primary-800 bg-primary-100 rounded-md px-3 py-2">
                  {/* The formula string was unconditional, so it claimed the
                      60/40 host-vs-apps split even when the backend used its
                      host-only or equal-weight fallback. Follow the shape of the
                      data instead of asserting one formula for every case. */}
                  <strong>Formula:</strong>{' '}
                  {(composite.formula?.description as string) || '60% × host OS score + 40% × criticality-weighted app average'}
                  {/* Read `penalties` (an array), not `penalty`. The singular
                      field does not exist on the response, so this note could
                      never render — the −10 penalty was applied to the score
                      silently, with nothing on screen explaining the drop. */}
                  {Array.isArray(composite.penalties) && composite.penalties.length > 0 && (
                    <span className="ml-2 text-amber-800">
                      {composite.penalties.map((p: any) => `· −${p.points} pts (${p.reason})`).join(' ')}
                    </span>
                  )}
                  {weakest && weakest.id !== assetId && (
                    <span className="ml-2 text-amber-800">· weakest: <strong>{weakest.name.split(' @')[0]}</strong> {weakest.score}%</span>
                  )}
                </div>
              )}

              {/* Per-asset rows */}
              <div className="space-y-1.5">
                {group.map((g: any) => {
                  const isHost = g.os_normalized && !['postgres', 'mssql', 'oracle', 'mysql', 'tomcat', 'iis', 'nginx', 'apache'].some((t: string) => (g.os_normalized || '').toLowerCase().includes(t));
                  return (
                    <div
                      key={g.id}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                        g.is_self
                          ? 'border-primary-400 bg-white font-medium'
                          : 'border-primary-100 bg-white/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                          g.score == null ? 'bg-slate-300' :
                          g.score >= 80 ? 'bg-emerald-500' :
                          g.score >= 60 ? 'bg-amber-500' : 'bg-rose-500'
                        }`} />
                        <span className="truncate text-slate-800">{g.name.split(' @')[0]}</span>
                        {g.is_self && <span className="text-[10px] bg-primary-100 text-primary-700 rounded px-1.5 py-0.5 font-semibold">this asset</span>}
                        {isHost && <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">host OS</span>}
                        {g.criticality && (
                          <span className={`text-[10px] rounded px-1.5 py-0.5 capitalize ${
                            g.criticality === 'critical' ? 'bg-rose-100 text-rose-700' :
                            g.criticality === 'high' ? 'bg-orange-100 text-orange-700' :
                            g.criticality === 'medium' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>{g.criticality}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                        {g.score != null ? (
                          <span className={`font-mono font-semibold ${scoreColor(g.score)}`}>{g.score}%</span>
                        ) : (
                          <span className="text-xs text-slate-400">not scanned</span>
                        )}
                        {!g.is_self && (
                          <Link href={`/risk-posture/asset/${g.id}`} className="text-xs text-primary-700 hover:underline">
                            posture →
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Business impact — the scoring-inputs form + live preview open in a
          popup so the page stays compact. */}
      <div className="relative">
        <button
          onClick={() => setOpenTile('business')}
          className="group flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary-300 hover:bg-slate-50"
        >
          <span className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><SlidersHorizontal className="h-4 w-4" /></span>
            <span>
              <span className="block text-sm font-semibold text-slate-800">Business impact &amp; scoring inputs</span>
              <span className="block text-xs text-slate-400">Customer/internet-facing · regulated data · operational dependency · CIA{isDirty && <span className="text-amber-700"> · ● unsaved</span>}</span>
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-700">Edit <ChevronRight className="h-4 w-4" /></span>
        </button>
        {/* Sibling, not nested inside the button — a <button> cannot contain
            another interactive control without breaking the DOM. */}
        <GuideMarker id="posture.businessImpact" n={4} className="absolute right-16 top-1/2 -translate-y-1/2" />
      </div>

      {openTile === 'business' && (
        // Closing discards edits. It used to only hide the modal, leaving the
        // changes live in `form` — so a value the user explicitly cancelled was
        // still sitting there and got written to the database by the next,
        // unrelated save. "Cancel" has to mean cancel.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => { hydrateForm(); setOpenTile(null); }}>
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h4 className="text-sm font-semibold text-slate-900">Business impact &amp; scoring inputs</h4>
              <button onClick={() => { hydrateForm(); setOpenTile(null); }}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT: Business Impact form */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          {/* Customer / Internet */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="flex items-center justify-between rounded-md border border-slate-200 p-2.5">
              <span className="text-xs">
                <div className="font-medium text-slate-800">Customer-facing</div>
                <div className="text-slate-500">External customers use it (1.2×)</div>
              </span>
              <input type="checkbox" className="h-4 w-4" checked={form.is_customer_facing}
                onChange={(e) => setForm({ ...form, is_customer_facing: e.target.checked })} />
            </label>
            <label className="flex items-center justify-between rounded-md border border-slate-200 p-2.5">
              <span className="text-xs">
                <div className="font-medium text-slate-800">Internet-facing</div>
                <div className="text-slate-500">Reachable from public internet (1.3×)</div>
              </span>
              <input type="checkbox" className="h-4 w-4" checked={form.is_internet_facing}
                onChange={(e) => setForm({ ...form, is_internet_facing: e.target.checked })} />
            </label>
          </div>

          {/* Regulated data */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">Regulated data</label>
            <select
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              value={form.regulated_data_type}
              onChange={(e) => setForm({ ...form, regulated_data_type: e.target.value })}
            >
              {REGULATED_DATA.map(o => (
                <option key={o.value} value={o.value}>{o.label} — {o.mult}</option>
              ))}
            </select>
          </div>

          {/* Operational dependency — radio with meanings */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">Operational dependency</label>
            <div className="space-y-1.5">
              {OP_DEP.map(o => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs ${
                    form.operational_dependency === o.value ? 'border-primary-300 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="op-dep"
                    className="mt-0.5"
                    checked={form.operational_dependency === o.value}
                    onChange={() => setForm({ ...form, operational_dependency: o.value })}
                  />
                  <span>
                    <span className="font-medium text-slate-800">{o.label} <span className="text-slate-400">({o.mult})</span></span>
                    <span className="block text-slate-600">{o.meaning}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* C / I / A sliders */}
          <div className="mb-3 grid grid-cols-3 gap-2">
            {(['confidentiality_rating', 'integrity_rating', 'availability_rating'] as const).map((k) => {
              const labels = {
                confidentiality_rating: 'Confidentiality',
                integrity_rating: 'Integrity',
                availability_rating: 'Availability',
              } as const;
              return (
                <div key={k} className="rounded-md border border-slate-200 p-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="uppercase tracking-wide">{labels[k]}</span>
                    <span className="font-semibold text-slate-800">{form[k]}/5</span>
                  </div>
                  <input
                    type="range" min={1} max={5} step={1}
                    className="mt-1 w-full"
                    value={form[k]}
                    onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
                  />
                </div>
              );
            })}
          </div>

          {/* Notes */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes (audit trail)</label>
            <textarea
              rows={2}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Bank teller PoS, regulated under SBP framework, etc."
              value={form.business_impact_notes}
              onChange={(e) => setForm({ ...form, business_impact_notes: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div className="text-[11px] text-slate-500">
              {isDirty ? <span className="text-amber-700">● unsaved changes</span> : <span>no changes</span>}
            </div>
            <div className="flex items-center gap-2">
              {saveMut.isError && <span className="text-xs text-rose-600">Save failed</span>}
              {saveMut.isSuccess && !isDirty && <span className="text-xs text-emerald-600">Saved</span>}
              <button
                disabled={!isDirty || saveMut.isPending}
                onClick={() => saveMut.mutate()}
                className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-40"
              >
                {saveMut.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Live preview */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Live preview</h2>

          {/* Current state — always shown */}
          <div className="rounded-md border border-slate-200 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">Current asset risk</div>
            <ScoreRow label="CIS gap" value={1 - (components.cis.pass_rate ?? 0) / 100} known={components.cis.known} />
            <ScoreRow label="CIA" value={components.cia.score} known={components.cia.known} />
            <ScoreRow label="Business" value={components.vuln?.effective_risk?.best_score ?? null} known={!!components.vuln?.effective_risk} />
            <div className="border-t border-slate-100 mt-2 pt-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700">overall</span>
              <span className={`text-sm font-semibold ${RING[bandLabel] ?? 'text-slate-900'}`}>
                {score == null ? '—' : `${score} / 100`}
              </span>
            </div>
          </div>

          {/* After your changes */}
          <div className="mt-3 rounded-md border border-primary-100 bg-primary-50/50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-primary-700 mb-2">After your changes</div>
            {!isDirty ? (
              <p className="text-xs text-slate-500">Change a value on the left to see how the risk score moves before saving.</p>
            ) : previewQ.isLoading ? (
              <p className="text-xs text-slate-500">Computing preview…</p>
            ) : previewQ.isError || !previewQ.data ? (
              <p className="text-xs text-rose-600">Preview unavailable.</p>
            ) : (
              <>
                <ScoreRow
                  label="Business"
                  value={previewQ.data.after_effective?.best_score ?? null}
                  known={!!previewQ.data.after_effective}
                  highlight
                />
                <div className="border-t border-primary-100 mt-2 pt-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">overall</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${RING[previewQ.data.after.band.label] ?? 'text-slate-900'}`}>
                      {previewQ.data.after.score} / 100
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${bandPill(previewQ.data.after.band.label)}`}>
                      {previewQ.data.after.band.label}
                    </span>
                    <span className={`text-xs font-medium ${
                      previewQ.data.delta > 0 ? 'text-rose-700' :
                      previewQ.data.delta < 0 ? 'text-emerald-700' : 'text-slate-500'
                    }`}>
                      ({previewQ.data.delta > 0 ? '▲ +' : previewQ.data.delta < 0 ? '▼ ' : ''}{previewQ.data.delta.toFixed(2)})
                    </span>
                  </div>
                </div>

                {/* Per-vuln re-score list */}
                {previewQ.data.before_effective?.per_vuln && previewQ.data.after_effective?.per_vuln && (
                  <div className="mt-3 border-t border-primary-100 pt-2">
                    <div className="text-[11px] uppercase tracking-wide text-primary-700 mb-1.5">Vulnerabilities re-scored</div>
                    <div className="space-y-1">
                      {previewQ.data.before_effective.per_vuln.map((b) => {
                        const a = previewQ.data!.after_effective!.per_vuln.find(x => x.vuln_id === b.vuln_id);
                        if (!a) return null;
                        const d = a.score - b.score;
                        const arrow = d > 0.005 ? '▲' : d < -0.005 ? '▼' : '·';
                        const cls = d > 0.005 ? 'text-rose-700' : d < -0.005 ? 'text-emerald-700' : 'text-slate-500';
                        return (
                          <div key={b.vuln_id} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-slate-700">{b.cve_id || `VULN-${b.vuln_id}`}</span>
                            <span className={`font-mono ${cls}`}>
                              {(b.score * 10).toFixed(1)} → {(a.score * 10).toFixed(1)} {arrow}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
            </div>
          </div>
        </div>
      )}

      {/* Stacked contributions — 5-series categorical data-viz (CIS / Vuln /
          CIA / Ctrl / Risk); dimension palette preserved to match the legend. */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-3">
          Score breakdown
          <GuideMarker id="posture.dimensions" n={5} />
        </h2>
        <div className="flex h-6 w-full rounded-md overflow-hidden bg-slate-100">
          <div className="bg-red-400 flex items-center justify-center text-[10px] text-white font-medium" style={{ width: `${contributions.cis}%` }} title={`CIS contributes ${contributions.cis} of ${score} points`}>
            {contributions.cis > 4 && contributions.cis}
          </div>
          <div className="bg-orange-400 flex items-center justify-center text-[10px] text-white font-medium" style={{ width: `${contributions.vuln}%` }} title={`Vulns contribute ${contributions.vuln} points`}>
            {contributions.vuln > 4 && contributions.vuln}
          </div>
          <div className="bg-purple-400 flex items-center justify-center text-[10px] text-white font-medium" style={{ width: `${contributions.cia}%` }} title={`CIA contributes ${contributions.cia} points`}>
            {contributions.cia > 4 && contributions.cia}
          </div>
          <div className="bg-blue-400 flex items-center justify-center text-[10px] text-white font-medium" style={{ width: `${contributions.ctrl}%` }} title={`Control gap contributes ${contributions.ctrl} points`}>
            {contributions.ctrl > 4 && contributions.ctrl}
          </div>
          <div className="bg-pink-400 flex items-center justify-center text-[10px] text-white font-medium" style={{ width: `${contributions.risk}%` }} title={`Linked risks contribute ${contributions.risk} points`}>
            {contributions.risk > 4 && contributions.risk}
          </div>
        </div>
        {/* The percentage shown per dimension is its EFFECTIVE share, not its raw
            weight. When dimensions are excluded for having no evidence, the rest
            are renormalised over the weight that remains — so on an asset with
            only vulnerabilities and CIA known, those two carry 100% of the score
            between them, not 45%. Printing the raw weight made the legend look
            broken: "CIA value (15%) → 16.7 pts" beside "Vulnerabilities (30%) →
            18.3 pts" reads as arithmetic that does not add up, when in fact both
            numbers are correct. */}
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-700">
          <span className={`flex items-center gap-1.5 ${!components.cis.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-red-400 rounded-sm" /> CIS gap ({components.cis.known ? `${Math.round((weights.cis / effWeight) * 100)}%` : `${Math.round(weights.cis * 100)}% muted`}) → {contributions.cis} pts {!components.cis.known && '· no data, excluded'}
          </span>
          <span className={`flex items-center gap-1.5 ${!components.vuln.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-orange-400 rounded-sm" /> Vulnerabilities ({components.vuln.known ? `${Math.round((weights.vuln / effWeight) * 100)}%` : `${Math.round(weights.vuln * 100)}% muted`}) → {contributions.vuln} pts {!components.vuln.known && '· no data, excluded'}
          </span>
          <span className={`flex items-center gap-1.5 ${!components.cia.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-purple-400 rounded-sm" /> CIA value ({components.cia.known ? `${Math.round((weights.cia / effWeight) * 100)}%` : `${Math.round(weights.cia * 100)}% muted`}) → {contributions.cia} pts {!components.cia.known && '· no data, excluded'}
          </span>
          <span className={`flex items-center gap-1.5 ${!components.ctrl.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-blue-400 rounded-sm" /> Control gap ({components.ctrl.known ? `${Math.round((weights.ctrl / effWeight) * 100)}%` : `${Math.round(weights.ctrl * 100)}% muted`}) → {contributions.ctrl} pts {!components.ctrl.known && '· no data, excluded'}
          </span>
          <span className={`flex items-center gap-1.5 ${!components.risk.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-pink-400 rounded-sm" /> Linked risks ({components.risk.known ? `${Math.round((weights.risk / effWeight) * 100)}%` : `${Math.round(weights.risk * 100)}% muted`}) → {contributions.risk} pts {!components.risk.known && '· no data, excluded'}
          </span>
        </div>
      </div>

      {/* Per-vulnerability breakdown — compact card opens the full triage-lens
          analysis in a popup, so the page stays short. */}
      {perVuln.length > 0 && (
        <button
          onClick={() => setOpenTile('vulns')}
          className="group flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary-300 hover:bg-slate-50"
        >
          <span className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><ShieldAlert className="h-4 w-4" /></span>
            <span>
              <span className="block text-sm font-semibold text-slate-800">Per-vulnerability risk breakdown</span>
              <span className="block text-xs text-slate-400">{perVuln.length} {perVuln.length === 1 ? 'vulnerability' : 'vulnerabilities'} · scanner vs. effective (triage lens)</span>
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-700">View <ChevronRight className="h-4 w-4" /></span>
        </button>
      )}

      {/* Existing 5 dimension panels */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="flex items-center text-sm font-semibold text-slate-800">
              <span className="inline-block w-2 h-2 bg-red-400 rounded-sm mr-2" />
              CIS Benchmark
              <GuideMarker id="posture.cisDimension" n={6} className="ml-1.5" />
            </h3>
            <Link href={`/compliance/plugins/asset/${asset.id}`} className="text-xs text-primary-700 hover:underline">
              View CIS details →
            </Link>
          </div>
          {components.cis.total === 0 ? (
            <p className="text-xs text-slate-500">No approved CIS rules in the library yet. Upload a CIS PDF in Plugin Automation to start scoring this dimension.</p>
          ) : components.cis.pass_rate == null ? (
            <p className="text-xs text-slate-500">No scans yet for this asset.</p>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <div className="text-3xl font-semibold text-slate-900">{components.cis.pass_rate}%</div>
                <div className="text-xs text-slate-500 pb-1">pass rate</div>
              </div>
              <div className="text-xs text-slate-600 mt-2 space-y-0.5">
                <div>✅ Passed: <strong>{components.cis.passed}</strong></div>
                <div>❌ Failed: <strong>{components.cis.failed}</strong></div>
                {components.cis.never_scanned ? <div>⏳ Never scanned: <strong>{components.cis.never_scanned}</strong> (counted toward gap)</div> : null}
                <div>Total rules: {components.cis.total}</div>
              </div>
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="flex items-center text-sm font-semibold text-slate-800">
              <span className="inline-block w-2 h-2 bg-orange-400 rounded-sm mr-2" />
              Vulnerabilities
              <GuideMarker id="posture.vulnDimension" n={7} className="ml-1.5" />
            </h3>
            <Link href="/vulnerabilities" className="text-xs text-primary-700 hover:underline">View all vulns →</Link>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-3xl font-semibold text-slate-900">{components.vuln.active_count}</div>
            <div className="text-xs text-slate-500 pb-1">
              active
              {components.vuln.total_linked > components.vuln.active_count && (
                <span className="text-slate-400"> ({components.vuln.total_linked} total linked)</span>
              )}
            </div>
          </div>
          <div className="text-xs text-slate-600 mt-2 space-y-0.5">
            <div>🔴 Critical: <strong>{components.vuln.by_severity.critical}</strong></div>
            <div>🟠 High: <strong>{components.vuln.by_severity.high}</strong></div>
            <div>🟡 Medium: <strong>{components.vuln.by_severity.medium}</strong></div>
            <div>🟢 Low: <strong>{components.vuln.by_severity.low}</strong></div>
            <div className="pt-1 text-slate-400">Severity-weighted points: {components.vuln.raw_points}</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="flex items-center text-sm font-semibold text-slate-800">
              <span className="inline-block w-2 h-2 bg-purple-400 rounded-sm mr-2" />
              CIA Criticality
              <GuideMarker id="posture.ciaDimension" n={8} className="ml-1.5" />
            </h3>
          </div>
          {components.cia.missing ? (
            <p className="text-xs text-amber-700">CIA ratings missing. Set them above to refine the risk score.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-center">
                <div className="text-2xl font-semibold text-slate-900">{components.cia.confidentiality ?? '–'}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Confidentiality</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-slate-900">{components.cia.integrity ?? '–'}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Integrity</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-slate-900">{components.cia.availability ?? '–'}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Availability</div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="flex items-center text-sm font-semibold text-slate-800">
              <span className="inline-block w-2 h-2 bg-blue-400 rounded-sm mr-2" />
              Control Coverage
              <GuideMarker id="posture.coverageDimension" n={9} className="ml-1.5" />
            </h3>
            <Link href={`/assets/${asset.id}`} className="text-xs text-primary-700 hover:underline">Link controls →</Link>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-3xl font-semibold text-slate-900">{components.ctrl.coverage_pct}%</div>
            <div className="text-xs text-slate-500 pb-1">covered</div>
          </div>
          <div className="text-xs text-slate-600 mt-2">
            <strong>{components.ctrl.linked_count}</strong> of target <strong>{components.ctrl.target}</strong> controls linked.
          </div>
        </div>
      </div>

      {/* Per-vulnerability breakdown popup */}
      {openTile === 'vulns' && perVuln.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setOpenTile(null)}>
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h4 className="text-sm font-semibold text-slate-900">Per-vulnerability risk breakdown</h4>
              <button onClick={() => setOpenTile(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <TriagedVulnSection perVuln={perVuln} asset={asset} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Type moved to top of file so it can be referenced by the main component too.

type TriageMode = 'scanner' | 'effective' | 'compare';

function TriagedVulnSection({ perVuln, asset }: { perVuln: PerVulnRow[]; asset: Posture['asset'] }) {
  const [mode, setMode] = useState<TriageMode>('compare');
  const [hideExploitSignals, setHideExploitSignals] = useState(false);

  // When "hide exploit signals" is on, recompute effective rank treating
  // EPSS=0 and KEV=false (i.e. asks: "what if we ignored these signals?")
  const effSortKey = (v: PerVulnRow) => {
    if (!hideExploitSignals) return v.score;
    // Recompute on the fly without EPSS or KEV contribution.
    return (v.score
      - (v.contributions?.epss || 0)
      - (v.contributions?.kev || 0));
  };

  const cvssSorted = useMemo(() =>
    [...perVuln].sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0)),
    [perVuln]);
  const effSorted = useMemo(() =>
    [...perVuln].sort((a, b) => effSortKey(b) - effSortKey(a)),
    [perVuln, hideExploitSignals]);

  const cvssRank = useMemo(() => {
    const m = new Map<number, number>();
    cvssSorted.forEach((v, i) => m.set(v.vuln_id, i + 1));
    return m;
  }, [cvssSorted]);
  const effRank = useMemo(() => {
    const m = new Map<number, number>();
    effSorted.forEach((v, i) => m.set(v.vuln_id, i + 1));
    return m;
  }, [effSorted]);

  const movers = useMemo(() =>
    perVuln
      .map(v => ({ v, cvss: cvssRank.get(v.vuln_id) || 0, eff: effRank.get(v.vuln_id) || 0 }))
      .filter(x => x.cvss !== x.eff)
      .sort((a, b) => Math.abs(b.cvss - b.eff) - Math.abs(a.cvss - a.eff)),
    [perVuln, cvssRank, effRank]);

  // Sanctioned severity ramp: critical=rose, high=orange, medium=amber, low=emerald.
  const sevColor = (sev?: string | null) => {
    switch ((sev || '').toLowerCase()) {
      case 'critical': return 'bg-rose-100 text-rose-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-amber-100 text-amber-800';
      case 'low': return 'bg-emerald-100 text-emerald-800';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div>
      {/* Human-in-the-loop control bar */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm font-semibold text-slate-800">Triage lens</div>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={hideExploitSignals}
              onChange={(e) => setHideExploitSignals(e.target.checked)}
            />
            <span className="text-slate-600">Ignore EPSS + KEV</span>
          </label>
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setMode('scanner')}
            className={`text-left rounded-md border-2 px-3 py-2 ${
              mode === 'scanner'
                ? 'border-slate-800 bg-white shadow-sm'
                : 'border-slate-200 bg-white/50 hover:border-slate-300'
            }`}
          >
            <div className="text-xs font-semibold text-slate-900">Scanner view</div>
            <div className="text-[11px] text-slate-500">Just what CVSS says — the old way.</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('effective')}
            className={`text-left rounded-md border-2 px-3 py-2 ${
              mode === 'effective'
                ? 'border-primary-600 bg-white shadow-sm'
                : 'border-slate-200 bg-white/50 hover:border-primary-300'
            }`}
          >
            <div className="text-xs font-semibold text-slate-900">Effective view <span className="text-[10px] text-primary-700 font-normal">(recommended)</span></div>
            <div className="text-[11px] text-slate-500">CVSS + EPSS + KEV + business impact.</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('compare')}
            className={`text-left rounded-md border-2 px-3 py-2 ${
              mode === 'compare'
                ? 'border-slate-600 bg-white shadow-sm'
                : 'border-slate-200 bg-white/50 hover:border-slate-400'
            }`}
          >
            <div className="text-xs font-semibold text-slate-900">Compare side-by-side</div>
            <div className="text-[11px] text-slate-500">See both, with rerank arrows.</div>
          </button>
        </div>
        {hideExploitSignals && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
            {/* This said "Effective scores now exclude EPSS and KEV", which was
                not true: the toggle only subtracts those contributions inside
                `effSortKey` for ORDERING. Every Effective score on screen still
                renders the full server-computed value. And for escalated vulns
                the subtraction is not even arithmetically meaningful, because
                `score` is the 0.85 floor rather than the sum of contributions.
                Say what it actually does. */}
            <strong>Ranking only.</strong> This reorders the list as if EPSS and KEV
            were absent. The scores shown are unchanged — they still include both.
          </div>
        )}
      </div>

      {/* Side-by-side ranking panels — only in compare mode */}
      {mode === 'compare' && (
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        {/* LEFT — CVSS only (the "Before" view) */}
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 overflow-hidden">
          <div className="bg-slate-200 px-4 py-2.5 border-b-2 border-slate-300">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600">Before — Scanner CVSS only</div>
            <div className="text-sm font-semibold text-slate-900">What the scanner alone says</div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-500">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">#</th>
                <th className="text-left px-3 py-1.5 font-medium">Vulnerability</th>
                <th className="text-right px-3 py-1.5 font-medium">CVSS</th>
              </tr>
            </thead>
            <tbody>
              {cvssSorted.map((v, i) => (
                <tr key={v.vuln_id} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-mono font-semibold text-slate-700">#{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-[11px] text-slate-700">{v.cve_id || `VULN-${v.vuln_id}`}</div>
                    <div className="text-slate-500 truncate max-w-[14rem]">{v.title || 'Untitled'}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-mono font-semibold ${sevColor(v.severity)}`}>
                      {v.cvss_score != null ? v.cvss_score.toFixed(1) : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* RIGHT — Effective risk (the "After" view) */}
        <div className="rounded-lg border-2 border-primary-400 bg-primary-50/40 overflow-hidden">
          <div className="bg-primary-100 px-4 py-2.5 border-b-2 border-primary-300">
            <div className="text-[10px] uppercase tracking-wider font-bold text-primary-700">After — Effective risk</div>
            <div className="text-sm font-semibold text-slate-900">CVSS + EPSS + KEV + Business impact</div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-primary-50 text-primary-700">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">#</th>
                <th className="text-left px-3 py-1.5 font-medium">Vulnerability</th>
                <th className="text-right px-3 py-1.5 font-medium">Effective</th>
                <th className="text-right px-3 py-1.5 font-medium">Δ rank</th>
              </tr>
            </thead>
            <tbody>
              {effSorted.map((v, i) => {
                const newRank = i + 1;
                const oldRank = cvssRank.get(v.vuln_id) || 0;
                const delta = oldRank - newRank; // positive = moved UP
                return (
                  <tr key={v.vuln_id} className="border-t border-primary-100">
                    <td className="px-3 py-2 font-mono font-semibold text-primary-700">#{newRank}</td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[11px] text-slate-700">{v.cve_id || `VULN-${v.vuln_id}`}</div>
                      <div className="text-slate-500 truncate max-w-[14rem]">{v.title || 'Untitled'}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-block rounded px-1.5 py-0.5 font-mono font-semibold ${sevColor(v.band)}`}>
                        {(v.score * 10).toFixed(1)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {delta === 0 ? (
                        <span className="text-slate-400">·</span>
                      ) : delta > 0 ? (
                        <span className="text-emerald-700 font-semibold" title={`Moved up ${delta} from CVSS rank #${oldRank}`}>
                          ▲ +{delta}
                        </span>
                      ) : (
                        <span className="text-rose-700 font-semibold" title={`Moved down ${-delta} from CVSS rank #${oldRank}`}>
                          ▼ {delta}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* The "why" callout — only in compare mode */}
      {mode === 'compare' && movers.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 mb-4 text-xs">
          <div className="font-semibold text-amber-900 mb-1.5">
            ⚡ Real-world signal changes the priority for {movers.length} vulnerabilit{movers.length === 1 ? 'y' : 'ies'}
          </div>
          <ul className="space-y-1 text-amber-900 font-mono">
            {movers.slice(0, 6).map(m => {
              const moved = m.cvss - m.eff;
              const direction = moved > 0 ? 'moved up' : 'moved down';
              const reason = m.v.kev_flag ? 'CISA KEV listed (actively exploited)' :
                (m.v.epss_score ?? 0) >= 0.7 ? `EPSS ${((m.v.epss_score || 0) * 100).toFixed(0)}% (highly likely)` :
                (m.v.epss_score ?? 0) < 0.1 ? `EPSS only ${((m.v.epss_score || 0) * 100).toFixed(0)}% (low exploit likelihood)` :
                m.v.business_impact_factor >= 1.3 ? `${m.v.business_impact_factor.toFixed(2)}× business impact` :
                'mixed signals';
              return (
                <li key={m.v.vuln_id}>
                  <span className={moved > 0 ? 'text-emerald-800' : 'text-rose-800'}>
                    {moved > 0 ? '▲' : '▼'} {Math.abs(moved)}
                  </span>{' '}
                  <span className="font-semibold">{m.v.cve_id || `VULN-${m.v.vuln_id}`}</span>{' '}
                  {direction} from CVSS #{m.cvss} → Effective #{m.eff} — {reason}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {mode === 'compare' && movers.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 mb-4 text-xs text-slate-600">
          For these {perVuln.length} vulnerabilit{perVuln.length === 1 ? 'y' : 'ies'} the two lenses agree — same triage order either way.
        </div>
      )}

      {/* Detailed boxed breakdown — always sorted by Effective risk (the recommendation) */}
      <div className="border-t border-slate-200 pt-4 mt-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">
            Per-vulnerability detail —{' '}
            {mode === 'scanner' && 'sorted by Scanner CVSS'}
            {mode === 'effective' && `sorted by Effective risk${hideExploitSignals ? ' (no EPSS/KEV)' : ''}`}
            {mode === 'compare' && 'sorted by Effective risk (the recommendation)'}
          </h3>
          <Link href={`/assets/${asset.id}?tab=vulnerabilities`} className="text-xs text-primary-700 hover:underline">
            Manage vulnerability links →
          </Link>
        </div>
        <div className="space-y-3">
          {(mode === 'scanner' ? cvssSorted : effSorted).map((v, i) => {
            const newRank = i + 1;
            const otherRank = mode === 'scanner' ? (effRank.get(v.vuln_id) || 0) : (cvssRank.get(v.vuln_id) || 0);
            const otherLabel = mode === 'scanner' ? 'Effective' : 'CVSS';
            const delta = otherRank - newRank;
            const badgeBg = mode === 'scanner' ? 'bg-slate-700 text-white' : 'bg-primary-600 text-[#0a0a0a]';
            return (
              <div key={v.vuln_id}>
                <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                  <span className={`rounded ${badgeBg} font-semibold px-1.5 py-0.5 text-[10px]`}>
                    #{newRank} by {mode === 'scanner' ? 'CVSS' : 'Effective'}
                  </span>
                  {delta === 0 ? (
                    <span className="text-slate-400">same as {otherLabel} rank</span>
                  ) : delta > 0 ? (
                    <span className="text-emerald-700">▲ moved up {delta} from {otherLabel} rank #{otherRank}</span>
                  ) : (
                    <span className="text-rose-700">▼ moved down {-delta} from {otherLabel} rank #{otherRank}</span>
                  )}
                </div>
                <VulnBreakdownCard v={v} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ScoreRow({ label, value, known, highlight }: { label: string; value: number | null | undefined; known: boolean; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-0.5 ${highlight ? 'font-medium' : ''}`}>
      <span className="text-xs text-slate-600">{label}</span>
      <span className={`font-mono text-xs ${known ? 'text-slate-900' : 'text-slate-400'}`}>
        {!known || value == null ? '—' : value.toFixed(3)}
      </span>
    </div>
  );
}

function VulnBreakdownCard({ v }: { v: NonNullable<Posture['components']['vuln']['effective_risk']>['per_vuln'][number] }) {
  const wCvss = 0.30, wEpss = 0.25, wKev = 0.20, wCia = 0.10, wBiz = 0.15;
  const ciaNorm = v.contributions.cia / (wCia || 1); // approx — using the backend-computed contribution
  const cvssOver10 = v.cvss_score != null ? v.cvss_score : 0;
  const epssPct = v.epss_score != null ? v.epss_score * 100 : null;

  return (
    <div className="rounded-md border border-slate-200">
      <div className={`flex items-center justify-between px-4 py-2 border-b border-slate-200 ${BAND_COLOR[v.band] || ''}`}>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-mono font-medium">{v.cve_id || `VULN-${v.vuln_id}`}</span>
          <span className="text-slate-700">{v.title || 'Untitled'}</span>
        </div>
        <div className="text-sm font-semibold">
          {(v.score * 10).toFixed(1)} / 10 <span className="uppercase text-[10px]">{v.band}</span>
          {v.escalated && <span className="ml-1 text-amber-800">⚠</span>}
        </div>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
        <Row k="Base CVSS"     v={v.cvss_score != null ? `${cvssOver10.toFixed(1)} / 10` : '—'} />
        <Row k="EPSS"          v={epssPct != null ? `${epssPct.toFixed(0)} %  (likelihood next 30d)` : 'no signal'} />
        <Row k="KEV"           v={v.kev_flag ? 'YES (CISA actively exploited)' : 'no'} />
        <Row k="Asset CIA max" v={`${Math.round(ciaNorm * 5)} / 5`} />
        <Row k="Business impact" v={`${v.business_impact_factor.toFixed(2)}× multiplier`} />
      </div>
      <div className="px-4 pb-3 border-t border-dashed border-slate-200 pt-2 text-xs font-mono text-slate-700">
        Weighted base:&nbsp;
        {wCvss}×{cvssOver10.toFixed(2)}/10 + {wEpss}×{(v.epss_score ?? 0).toFixed(2)} + {wKev}×{v.kev_flag ? '1' : '0'} +
        {' '}{wCia}×{(ciaNorm).toFixed(2)} + {wBiz}×{(v.business_impact_factor - 1).toFixed(2)}
        {' '}= <strong>{v.score.toFixed(3)}</strong>
      </div>
      {v.escalated && (
        <div className="px-4 pb-2 text-xs text-amber-800">
          Escalation: floor at 0.85 — (EPSS ≥ 0.7 OR KEV) AND (CIA ≥ 4 OR biz ≥ 1.3).
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-900 text-right">{v}</span>
    </div>
  );
}
