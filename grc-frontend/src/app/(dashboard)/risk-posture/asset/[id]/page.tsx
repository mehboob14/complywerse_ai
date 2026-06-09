'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assetsApi, riskPostureApi } from '@/lib/api';

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

const BAND_COLOR: Record<string, string> = {
  low: 'bg-green-100 text-green-800 border-green-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  moderate: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
  unknown: 'bg-gray-100 text-gray-700 border-gray-200',
};

const RING: Record<string, string> = {
  low: 'text-green-600',
  medium: 'text-yellow-600',
  moderate: 'text-yellow-600',
  high: 'text-orange-600',
  critical: 'text-red-600',
  unknown: 'text-gray-400',
};

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
  const assetId = params ? Number(params.id) : 0;
  const queryClient = useQueryClient();

  const postureQ = useQuery<Posture>({
    queryKey: ['risk-posture.asset', assetId],
    queryFn: async () => (await riskPostureApi.asset(assetId)).data,
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

  useEffect(() => {
    if (!assetQ.data) return;
    setForm({
      is_customer_facing: assetQ.data.is_customer_facing ?? false,
      is_internet_facing: assetQ.data.is_internet_facing ?? false,
      regulated_data_type: assetQ.data.regulated_data_type || 'none',
      operational_dependency: assetQ.data.operational_dependency || 'medium',
      confidentiality_rating: assetQ.data.confidentiality_rating ?? defaultCIA,
      integrity_rating: assetQ.data.integrity_rating ?? defaultCIA,
      availability_rating: assetQ.data.availability_rating ?? defaultCIA,
      business_impact_notes: assetQ.data.business_impact_notes ?? '',
    });
  }, [assetQ.data?.id, defaultCIA]);

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
      queryClient.invalidateQueries({ queryKey: ['risk-posture-dashboard'] });
    },
  });

  if (postureQ.isLoading || assetQ.isLoading) return <div className="p-6 text-sm text-gray-500">Loading risk breakdown…</div>;
  if (postureQ.isError || !postureQ.data || assetQ.isError || !assetQ.data) {
    return (
      <div className="p-6">
        <Link href="/risk-posture" className="text-sm text-blue-600 hover:underline">← Back to Risk Posture</Link>
        <div className="mt-4 text-sm text-red-600">Failed to load asset.</div>
      </div>
    );
  }

  const { asset, score, band, weights, components, contributions, data_quality, known_dimensions } = postureQ.data;
  const bandLabel = band.label;
  const perVuln = components.vuln?.effective_risk?.per_vuln || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Link href="/risk-posture" className="text-sm text-blue-600 hover:underline">← Back to Risk Posture</Link>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-gray-500">{asset.asset_type || 'Asset'}</div>
            <h1 className="text-2xl font-semibold text-gray-900">{asset.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
              {asset.host_name && <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{asset.host_name}</span>}
              {asset.ip_address && <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{asset.ip_address}</span>}
              {asset.owner_name && <span>Owner: {asset.owner_name}</span>}
              {asset.criticality && <span className="capitalize">Criticality: {asset.criticality}</span>}
            </div>
          </div>
          <div className="text-center">
            <div className={`text-5xl font-bold ${RING[bandLabel] ?? 'text-gray-900'}`}>{score == null ? '—' : score}</div>
            <div className="text-xs text-gray-500">/ 100 risk score</div>
            <span className={`mt-2 inline-block px-3 py-1 rounded-full text-xs font-medium uppercase ${bandPill(bandLabel)}`}>
              {bandLabel} — {band.description}
            </span>
            <div className="text-[10px] text-gray-500 mt-2">
              Data quality:{' '}
              <strong className={
                data_quality >= 75 ? 'text-green-700'
                : data_quality >= 50 ? 'text-yellow-700'
                : data_quality >= 25 ? 'text-orange-700' : 'text-red-700'
              }>{data_quality}%</strong>
              {' '}({known_dimensions.length}/5 dimensions)
            </div>
          </div>
        </div>
      </div>

      {/* Business Impact + Live Preview — split pane */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT: Business Impact form */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">Business Impact — {asset.name}</h2>
            <span className="text-[10px] uppercase tracking-wide text-gray-400">drives the formula</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Saves to the asset; recompute fires automatically. Change values to preview the new score before saving.
          </p>

          {/* Customer / Internet */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="flex items-center justify-between rounded-md border border-gray-200 p-2.5">
              <span className="text-xs">
                <div className="font-medium text-gray-800">Customer-facing</div>
                <div className="text-gray-500">External customers use it (1.2×)</div>
              </span>
              <input type="checkbox" className="h-4 w-4" checked={form.is_customer_facing}
                onChange={(e) => setForm({ ...form, is_customer_facing: e.target.checked })} />
            </label>
            <label className="flex items-center justify-between rounded-md border border-gray-200 p-2.5">
              <span className="text-xs">
                <div className="font-medium text-gray-800">Internet-facing</div>
                <div className="text-gray-500">Reachable from public internet (1.3×)</div>
              </span>
              <input type="checkbox" className="h-4 w-4" checked={form.is_internet_facing}
                onChange={(e) => setForm({ ...form, is_internet_facing: e.target.checked })} />
            </label>
          </div>

          {/* Regulated data */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Regulated data</label>
            <select
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Operational dependency</label>
            <p className="text-[11px] italic text-gray-500 mb-2">How much does the bank suffer when this asset goes down?</p>
            <div className="space-y-1.5">
              {OP_DEP.map(o => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs ${
                    form.operational_dependency === o.value ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
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
                    <span className="font-medium text-gray-800">{o.label} <span className="text-gray-400">({o.mult})</span></span>
                    <span className="block text-gray-600">{o.meaning}</span>
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
                <div key={k} className="rounded-md border border-gray-200 p-2">
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span className="uppercase tracking-wide">{labels[k]}</span>
                    <span className="font-semibold text-gray-800">{form[k]}/5</span>
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes (audit trail)</label>
            <textarea
              rows={2}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="Bank teller PoS, regulated under SBP framework, etc."
              value={form.business_impact_notes}
              onChange={(e) => setForm({ ...form, business_impact_notes: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div className="text-[11px] text-gray-500">
              {isDirty ? <span className="text-amber-700">● unsaved changes</span> : <span>no changes</span>}
            </div>
            <div className="flex items-center gap-2">
              {saveMut.isError && <span className="text-xs text-red-600">Save failed</span>}
              {saveMut.isSuccess && !isDirty && <span className="text-xs text-green-600">Saved</span>}
              <button
                disabled={!isDirty || saveMut.isPending}
                onClick={() => saveMut.mutate()}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {saveMut.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Live preview */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">Live preview</h2>
            <span className="text-[10px] uppercase tracking-wide text-gray-400">no data is written until Save</span>
          </div>

          {/* Current state — always shown */}
          <div className="rounded-md border border-gray-200 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Current asset risk</div>
            <ScoreRow label="CIS gap" value={1 - (components.cis.pass_rate ?? 0) / 100} known={components.cis.known} />
            <ScoreRow label="CIA" value={components.cia.score} known={components.cia.known} />
            <ScoreRow label="Business" value={components.vuln?.effective_risk?.best_score ?? null} known={!!components.vuln?.effective_risk} />
            <div className="border-t border-gray-100 mt-2 pt-2 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">overall</span>
              <span className={`text-sm font-semibold ${RING[bandLabel] ?? 'text-gray-900'}`}>
                {score == null ? '—' : `${score} / 100`}
              </span>
            </div>
          </div>

          {/* After your changes */}
          <div className="mt-3 rounded-md border border-blue-100 bg-blue-50/50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-blue-700 mb-2">After your changes</div>
            {!isDirty ? (
              <p className="text-xs text-gray-500">Change a value on the left to see how the risk score moves before saving.</p>
            ) : previewQ.isLoading ? (
              <p className="text-xs text-gray-500">Computing preview…</p>
            ) : previewQ.isError || !previewQ.data ? (
              <p className="text-xs text-red-600">Preview unavailable.</p>
            ) : (
              <>
                <ScoreRow
                  label="Business"
                  value={previewQ.data.after_effective?.best_score ?? null}
                  known={!!previewQ.data.after_effective}
                  highlight
                />
                <div className="border-t border-blue-100 mt-2 pt-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700">overall</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${RING[previewQ.data.after.band.label] ?? 'text-gray-900'}`}>
                      {previewQ.data.after.score} / 100
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${bandPill(previewQ.data.after.band.label)}`}>
                      {previewQ.data.after.band.label}
                    </span>
                    <span className={`text-xs font-medium ${
                      previewQ.data.delta > 0 ? 'text-red-700' :
                      previewQ.data.delta < 0 ? 'text-green-700' : 'text-gray-500'
                    }`}>
                      ({previewQ.data.delta > 0 ? '▲ +' : previewQ.data.delta < 0 ? '▼ ' : ''}{previewQ.data.delta.toFixed(2)})
                    </span>
                  </div>
                </div>

                {/* Business Impact Factor breakdown — explains WHY the
                    score moved or didn't. The formula uses MAX of 4
                    multipliers, so changing one rarely shifts the
                    overall biz_factor unless it was THE one driving the
                    MAX. Without this surface, operators rightly say
                    "I changed 3 things, why did nothing happen?" */}
                {(() => {
                  // Recompute biz_factor on both sides from the form
                  // values vs the asset's saved values. Keeps math
                  // visible to the operator — same formula the backend
                  // applies.
                  const a = assetQ.data;
                  if (!a) return null;
                  // Keep these in sync with backend
                  // _REGULATED_DATA_MULTIPLIER (effective_risk.py:35).
                  // All four regulated-data categories share 1.4 per the
                  // v2 spec; PII used to be 1.3 — fixed.
                  const regulatedMult: Record<string, number> = {
                    none: 1.0, pii: 1.4, pci: 1.4, phi: 1.4, financial: 1.4, multiple: 1.4,
                  };
                  const opDepMult: Record<string, number> = {
                    low: 0.8, medium: 1.0, high: 1.3, critical: 1.5,
                  };

                  // BEFORE (current saved values from the API response)
                  const beforeFactors = [
                    { name: 'Customer-facing', on: !!a.is_customer_facing, val: a.is_customer_facing ? 1.2 : 1.0 },
                    { name: 'Internet-facing', on: !!a.is_internet_facing, val: a.is_internet_facing ? 1.3 : 1.0 },
                    { name: `Regulated data = ${(a.regulated_data_type || 'none').toUpperCase()}`, on: (a.regulated_data_type || 'none') !== 'none', val: regulatedMult[a.regulated_data_type || 'none'] ?? 1.0 },
                    { name: `Op dependency = ${(a.operational_dependency || 'medium').toUpperCase()}`, on: (a.operational_dependency || 'medium') !== 'medium', val: opDepMult[a.operational_dependency || 'medium'] ?? 1.0 },
                  ];
                  const beforeMax = Math.max(...beforeFactors.map(f => f.val));
                  const beforeDriver = beforeFactors.find(f => f.val === beforeMax && beforeMax > 1.0);

                  // AFTER (form proposal)
                  const afterFactors = [
                    { name: 'Customer-facing', on: form.is_customer_facing, val: form.is_customer_facing ? 1.2 : 1.0 },
                    { name: 'Internet-facing', on: form.is_internet_facing, val: form.is_internet_facing ? 1.3 : 1.0 },
                    { name: `Regulated data = ${(form.regulated_data_type || 'none').toUpperCase()}`, on: (form.regulated_data_type || 'none') !== 'none', val: regulatedMult[form.regulated_data_type || 'none'] ?? 1.0 },
                    { name: `Op dependency = ${(form.operational_dependency || 'medium').toUpperCase()}`, on: (form.operational_dependency || 'medium') !== 'medium', val: opDepMult[form.operational_dependency || 'medium'] ?? 1.0 },
                  ];
                  const afterMax = Math.max(...afterFactors.map(f => f.val));
                  const afterDriver = afterFactors.find(f => f.val === afterMax && afterMax > 1.0);

                  const sameMax = Math.abs(beforeMax - afterMax) < 0.001;

                  return (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/70 p-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Business impact factor (MAX of multipliers)</div>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <div className="text-slate-600">Before</div>
                          <div className="mt-0.5 font-mono text-base font-bold text-slate-900">{beforeMax.toFixed(2)}×</div>
                          <div className="text-[10px] text-slate-500">
                            driven by: {beforeDriver?.name || '(nothing — all defaults)'}
                          </div>
                        </div>
                        <div>
                          <div className="text-blue-600">After</div>
                          <div className="mt-0.5 font-mono text-base font-bold text-blue-900">{afterMax.toFixed(2)}×</div>
                          <div className="text-[10px] text-blue-500">
                            driven by: {afterDriver?.name || '(nothing — all defaults)'}
                          </div>
                        </div>
                      </div>
                      {sameMax && Math.abs(previewQ.data.delta) < 0.005 && (
                        <div className="mt-2 text-[11px] text-amber-900">
                          <strong>Score didn't move because:</strong> the MAX multiplier is unchanged at <strong>{beforeMax.toFixed(2)}×</strong> — only one factor needs to be high for the business impact to land at this value. To drop the score, every factor must fall below the current MAX.
                        </div>
                      )}
                      {!sameMax && (
                        <div className="mt-2 text-[11px] text-amber-900">
                          MAX shifted from <strong>{beforeMax.toFixed(2)}×</strong> to <strong>{afterMax.toFixed(2)}×</strong>.
                          {afterMax < beforeMax && ' Score should drop.'}
                          {afterMax > beforeMax && ' Score should rise.'}
                        </div>
                      )}
                      <div className="mt-2 text-[10px] text-slate-500 italic">
                        Business impact is ~4.5% of the overall score weight, so visible movement requires either a large factor shift OR vulns at the escalation threshold.
                      </div>
                    </div>
                  );
                })()}

                {/* Per-vuln re-score list */}
                {previewQ.data.before_effective?.per_vuln && previewQ.data.after_effective?.per_vuln && (
                  <div className="mt-3 border-t border-blue-100 pt-2">
                    <div className="text-[11px] uppercase tracking-wide text-blue-700 mb-1.5">Vulnerabilities re-scored</div>
                    <div className="space-y-1">
                      {previewQ.data.before_effective.per_vuln.map((b) => {
                        const a = previewQ.data!.after_effective!.per_vuln.find(x => x.vuln_id === b.vuln_id);
                        if (!a) return null;
                        const d = a.score - b.score;
                        const arrow = d > 0.005 ? '▲' : d < -0.005 ? '▼' : '·';
                        const cls = d > 0.005 ? 'text-red-700' : d < -0.005 ? 'text-green-700' : 'text-gray-500';
                        return (
                          <div key={b.vuln_id} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-gray-700">{b.cve_id || `VULN-${b.vuln_id}`}</span>
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

      {/* Stacked contributions */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Score breakdown — which dimension contributed how much</h2>
        <div className="flex h-6 w-full rounded-md overflow-hidden bg-gray-100">
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
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-700">
          <span className={`flex items-center gap-1.5 ${!components.cis.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-red-400 rounded-sm" /> CIS gap ({Math.round(weights.cis * 100)}%) → {contributions.cis} pts {!components.cis.known && '(no data)'}
          </span>
          <span className={`flex items-center gap-1.5 ${!components.vuln.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-orange-400 rounded-sm" /> Vulnerabilities ({Math.round(weights.vuln * 100)}%) → {contributions.vuln} pts
          </span>
          <span className={`flex items-center gap-1.5 ${!components.cia.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-purple-400 rounded-sm" /> CIA value ({Math.round(weights.cia * 100)}%) → {contributions.cia} pts {!components.cia.known && '(no data)'}
          </span>
          <span className={`flex items-center gap-1.5 ${!components.ctrl.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-blue-400 rounded-sm" /> Control gap ({Math.round(weights.ctrl * 100)}%) → {contributions.ctrl} pts
          </span>
          <span className={`flex items-center gap-1.5 ${!components.risk.known ? 'opacity-40' : ''}`}>
            <span className="inline-block w-2 h-2 bg-pink-400 rounded-sm" /> Linked risks ({Math.round(weights.risk * 100)}%) → {contributions.risk} pts {!components.risk.known && '(no data)'}
          </span>
        </div>
      </div>

      {/* Per-vulnerability boxed breakdown — with Triage Lens toggle */}
      {perVuln.length > 0 && (
        <TriagedVulnSection perVuln={perVuln} asset={asset} />
      )}

      {/* Existing 5 dimension panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-red-400 rounded-sm mr-2" />
              CIS Benchmark
            </h3>
            <Link href={`/compliance/plugins/asset/${asset.id}`} className="text-xs text-blue-600 hover:underline">
              View CIS details →
            </Link>
          </div>
          {components.cis.total === 0 ? (
            <p className="text-xs text-gray-500">No approved CIS rules in the library yet. Upload a CIS PDF in Plugin Automation to start scoring this dimension.</p>
          ) : components.cis.pass_rate == null ? (
            <p className="text-xs text-gray-500">No scans yet for this asset.</p>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <div className="text-3xl font-semibold text-gray-900">{components.cis.pass_rate}%</div>
                <div className="text-xs text-gray-500 pb-1">pass rate</div>
              </div>
              <div className="text-xs text-gray-600 mt-2 space-y-0.5">
                <div>✅ Passed: <strong>{components.cis.passed}</strong></div>
                <div>❌ Failed: <strong>{components.cis.failed}</strong></div>
                {components.cis.never_scanned ? <div>⏳ Never scanned: <strong>{components.cis.never_scanned}</strong> (counted toward gap)</div> : null}
                <div>Total rules: {components.cis.total}</div>
              </div>
            </>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-orange-400 rounded-sm mr-2" />
              Vulnerabilities
            </h3>
            <Link href="/vulnerabilities" className="text-xs text-blue-600 hover:underline">View all vulns →</Link>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-3xl font-semibold text-gray-900">{components.vuln.active_count}</div>
            <div className="text-xs text-gray-500 pb-1">
              active
              {components.vuln.total_linked > components.vuln.active_count && (
                <span className="text-gray-400"> ({components.vuln.total_linked} total linked)</span>
              )}
            </div>
          </div>
          <div className="text-xs text-gray-600 mt-2 space-y-0.5">
            <div>🔴 Critical: <strong>{components.vuln.by_severity.critical}</strong></div>
            <div>🟠 High: <strong>{components.vuln.by_severity.high}</strong></div>
            <div>🟡 Medium: <strong>{components.vuln.by_severity.medium}</strong></div>
            <div>🟢 Low: <strong>{components.vuln.by_severity.low}</strong></div>
            <div className="pt-1 text-gray-400">Severity-weighted points: {components.vuln.raw_points}</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-purple-400 rounded-sm mr-2" />
              CIA Criticality
            </h3>
          </div>
          {components.cia.missing ? (
            <p className="text-xs text-amber-700">CIA ratings missing. Set them above to refine the risk score.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-center">
                <div className="text-2xl font-semibold text-gray-900">{components.cia.confidentiality ?? '–'}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Confidentiality</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-gray-900">{components.cia.integrity ?? '–'}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Integrity</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-gray-900">{components.cia.availability ?? '–'}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Availability</div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              <span className="inline-block w-2 h-2 bg-blue-400 rounded-sm mr-2" />
              Control Coverage
            </h3>
            <Link href={`/assets/${asset.id}`} className="text-xs text-blue-600 hover:underline">Link controls →</Link>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-3xl font-semibold text-gray-900">{components.ctrl.coverage_pct}%</div>
            <div className="text-xs text-gray-500 pb-1">covered</div>
          </div>
          {/* Progress bar — fills as coverage approaches target */}
          <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                components.ctrl.coverage_pct >= 75 ? 'bg-emerald-500' :
                components.ctrl.coverage_pct >= 25 ? 'bg-amber-500' :
                'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, components.ctrl.coverage_pct)}%` }}
            />
          </div>
          <div className="text-xs text-gray-600 mt-2">
            <strong>{components.ctrl.linked_count}</strong> of target <strong>{components.ctrl.target}</strong> controls linked.
          </div>
          {/* Honest impact callout — explains the counter-intuitive "1st
              control raises score" behaviour. When dimension flips from
              known=False (excluded) to known=True (at low coverage), the
              total risk score goes UP because we're now tracking a gap
              that was previously invisible. Adding more controls fills
              the gap and drops the score back down. */}
          {components.ctrl.known && components.ctrl.coverage_pct < 75 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
              <strong className="block mb-0.5">Why adding 1 control didn't drop the score:</strong>
              The Control dimension was previously <em>not measured</em> and excluded
              from the formula. Linking your first control turns it ON at{' '}
              <strong>{components.ctrl.coverage_pct}% coverage</strong> — counted as a{' '}
              <strong>{Math.round((1 - components.ctrl.score) * 100)}%</strong> credit, but exposes a{' '}
              <strong>{Math.round(components.ctrl.score * 100)}%</strong> uncovered gap.
              Link more controls (target {components.ctrl.target}) to grow the credit.
            </div>
          )}
          {components.ctrl.known && components.ctrl.coverage_pct >= 75 && (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-900">
              <strong>Solid coverage.</strong> {components.ctrl.coverage_pct}% of the target met —
              the Control dimension is reducing this asset's risk score.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type PerVulnRow = NonNullable<Posture['components']['vuln']['effective_risk']>['per_vuln'][number];

type TriageMode = 'scanner' | 'effective' | 'compare';

function TriagedVulnSection({ perVuln, asset }: { perVuln: PerVulnRow[]; asset: Posture['asset'] }) {
  const [mode, setMode] = useState<TriageMode>('compare');
  const [hideExploitSignals, setHideExploitSignals] = useState(false);

  // ── Prioritization filters (CVSS + EPSS + KEV + Business signals) ────
  // The effective-risk formula already weights all 4 signals, but
  // operators also want to SLICE the list by them so they can answer:
  //   "show me only what's KEV-listed AND likely to be exploited in
  //    the next 30 days AND lives on a high-business-impact host"
  // These four filters intersect; defaults are permissive (all vulns).
  const [filterKev, setFilterKev] = useState<'all' | 'kev_only' | 'no_kev'>('all');
  const [filterEpss, setFilterEpss] = useState<number>(0);     // 0 / 0.3 / 0.5 / 0.7
  const [filterBiz, setFilterBiz] = useState<number>(1.0);     // 1.0 / 1.2 / 1.3 / 1.4
  const [filterBand, setFilterBand] = useState<'all' | 'critical' | 'high_plus'>('all');

  // Apply filters BEFORE sorting so the rerank arrows still make sense
  // (they compare CVSS-order vs effective-order within the filtered set).
  const filteredVulns = useMemo(() => {
    return perVuln.filter((v) => {
      // KEV
      const isKev = !!v.kev_flag;
      if (filterKev === 'kev_only' && !isKev) return false;
      if (filterKev === 'no_kev'   &&  isKev) return false;
      // EPSS (next-30d exploit likelihood from FIRST.org)
      if (filterEpss > 0 && (v.epss_score ?? 0) < filterEpss) return false;
      // Business impact factor on this asset (formula MAX of 4 multipliers)
      if (filterBiz > 1.0 && (v.business_impact_factor ?? 1.0) < filterBiz) return false;
      // Band (after-formula severity)
      if (filterBand === 'critical' && v.band !== 'critical') return false;
      if (filterBand === 'high_plus' && !['critical', 'high'].includes(v.band || '')) return false;
      return true;
    });
  }, [perVuln, filterKev, filterEpss, filterBiz, filterBand]);

  const filtersActive =
    filterKev !== 'all' || filterEpss > 0 || filterBiz > 1.0 || filterBand !== 'all';
  const resetFilters = () => {
    setFilterKev('all'); setFilterEpss(0); setFilterBiz(1.0); setFilterBand('all');
  };

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
    [...filteredVulns].sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0)),
    [filteredVulns]);
  const effSorted = useMemo(() =>
    [...filteredVulns].sort((a, b) => effSortKey(b) - effSortKey(a)),
    [filteredVulns, hideExploitSignals]);

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
    filteredVulns
      .map(v => ({ v, cvss: cvssRank.get(v.vuln_id) || 0, eff: effRank.get(v.vuln_id) || 0 }))
      .filter(x => x.cvss !== x.eff)
      .sort((a, b) => Math.abs(b.cvss - b.eff) - Math.abs(a.cvss - a.eff)),
    [filteredVulns, cvssRank, effRank]);

  const sevColor = (sev?: string | null) => {
    switch ((sev || '').toLowerCase()) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
      {/* Human-in-the-loop control bar */}
      <div className="mb-4 rounded-lg border-2 border-blue-200 bg-blue-50/60 p-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-blue-700">You choose the lens</div>
            <div className="text-sm font-semibold text-gray-900">How do you want to triage this asset's vulnerabilities?</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 mr-1">Simulate:</span>
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={hideExploitSignals}
                onChange={(e) => setHideExploitSignals(e.target.checked)}
              />
              <span className="text-gray-700">Pretend EPSS + KEV don't exist</span>
            </label>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setMode('scanner')}
            className={`text-left rounded-md border-2 px-3 py-2 ${
              mode === 'scanner'
                ? 'border-gray-800 bg-white shadow-sm'
                : 'border-gray-200 bg-white/50 hover:border-gray-300'
            }`}
          >
            <div className="text-xs font-semibold text-gray-900">Scanner view</div>
            <div className="text-[11px] text-gray-500">Just what CVSS says — the old way.</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('effective')}
            className={`text-left rounded-md border-2 px-3 py-2 ${
              mode === 'effective'
                ? 'border-blue-600 bg-white shadow-sm'
                : 'border-gray-200 bg-white/50 hover:border-blue-300'
            }`}
          >
            <div className="text-xs font-semibold text-gray-900">Effective view <span className="text-[10px] text-blue-600 font-normal">(recommended)</span></div>
            <div className="text-[11px] text-gray-500">CVSS + EPSS + KEV + business impact.</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('compare')}
            className={`text-left rounded-md border-2 px-3 py-2 ${
              mode === 'compare'
                ? 'border-amber-500 bg-white shadow-sm'
                : 'border-gray-200 bg-white/50 hover:border-amber-300'
            }`}
          >
            <div className="text-xs font-semibold text-gray-900">Compare side-by-side</div>
            <div className="text-[11px] text-gray-500">See both, with rerank arrows.</div>
          </button>
        </div>
        {hideExploitSignals && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
            <strong>What-if:</strong> The "Effective" column is now computed without EPSS or KEV — pretending those feeds don't exist — to show what difference real-world signals actually make.
          </div>
        )}
      </div>

      {/* ── Prioritization filters — slice by KEV / EPSS / Biz / Band ───
          The effective_risk formula already INCLUDES all 4 signals; this
          panel lets the operator FILTER the list by them so they can
          answer "show me only what's exploit-known + likely + on a
          high-biz host". Filters intersect; "Reset" sets all to permissive. */}
      <div className="mb-4 rounded-lg border-2 border-indigo-200 bg-indigo-50/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-indigo-700">Prioritize what to fix first</div>
            <div className="text-xs text-gray-600">Slice the list by exploit signals + business impact. Applies to all views below.</div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold ${filtersActive ? 'text-indigo-700' : 'text-gray-500'}`}>
              {filtersActive ? (
                <>Showing <strong>{filteredVulns.length}</strong> of {perVuln.length} vulns</>
              ) : (
                <>{perVuln.length} vulnerabilities</>
              )}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-[11px] text-indigo-700 hover:text-indigo-900 underline"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* KEV — exploit publicly known */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-0.5">
              🚨 Exploit known (KEV)
            </label>
            <select
              value={filterKev}
              onChange={(e) => setFilterKev(e.target.value as any)}
              className="w-full rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-800"
            >
              <option value="all">Any</option>
              <option value="kev_only">KEV-listed only</option>
              <option value="no_kev">Not on KEV</option>
            </select>
          </div>
          {/* EPSS — exploit likelihood in next 30 days */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-0.5">
              📈 Exploit likely next 30d (EPSS)
            </label>
            <select
              value={filterEpss}
              onChange={(e) => setFilterEpss(Number(e.target.value))}
              className="w-full rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-800"
            >
              <option value={0}>Any</option>
              <option value={0.3}>≥ 30% likely</option>
              <option value={0.5}>≥ 50% likely</option>
              <option value={0.7}>≥ 70% likely (high)</option>
            </select>
          </div>
          {/* Business impact factor */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-0.5">
              🏢 Business impact (MAX×)
            </label>
            <select
              value={filterBiz}
              onChange={(e) => setFilterBiz(Number(e.target.value))}
              className="w-full rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-800"
            >
              <option value={1.0}>Any</option>
              <option value={1.2}>≥ 1.2× (customer-facing)</option>
              <option value={1.3}>≥ 1.3× (internet-facing OR high-dep)</option>
              <option value={1.4}>≥ 1.4× (regulated data)</option>
              <option value={1.5}>≥ 1.5× (critical dependency)</option>
            </select>
          </div>
          {/* After-formula band */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-0.5">
              🎯 Effective band (after formula)
            </label>
            <select
              value={filterBand}
              onChange={(e) => setFilterBand(e.target.value as any)}
              className="w-full rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-800"
            >
              <option value="all">Any band</option>
              <option value="critical">Critical only (≥ 0.85)</option>
              <option value="high_plus">High + Critical (≥ 0.70)</option>
            </select>
          </div>
        </div>
        {/* Quick presets — common "fix-first" combinations operators ask for */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-gray-500 mr-1">Quick presets:</span>
          <button
            type="button"
            onClick={() => { setFilterKev('kev_only'); setFilterEpss(0.7); setFilterBiz(1.0); setFilterBand('all'); }}
            className="rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-red-800 hover:bg-red-100 font-medium"
            title="KEV-listed + EPSS ≥ 70%"
          >
            🔥 Fix now (KEV + likely)
          </button>
          <button
            type="button"
            onClick={() => { setFilterKev('all'); setFilterEpss(0.5); setFilterBiz(1.3); setFilterBand('all'); }}
            className="rounded-full border border-orange-300 bg-orange-50 px-2.5 py-0.5 text-orange-800 hover:bg-orange-100 font-medium"
            title="EPSS ≥ 50% on high-impact host"
          >
            ⚠ Likely + high-impact
          </button>
          <button
            type="button"
            onClick={() => { setFilterKev('all'); setFilterEpss(0); setFilterBiz(1.0); setFilterBand('critical'); }}
            className="rounded-full border border-purple-300 bg-purple-50 px-2.5 py-0.5 text-purple-800 hover:bg-purple-100 font-medium"
            title="Effective score ≥ 0.85"
          >
            🚨 Critical band only
          </button>
          <button
            type="button"
            onClick={() => { setFilterKev('no_kev'); setFilterEpss(0); setFilterBiz(1.0); setFilterBand('all'); }}
            className="rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-green-800 hover:bg-green-100 font-medium"
            title="Not yet weaponised — lower urgency"
          >
            🛡 Not weaponised yet
          </button>
        </div>
        {filtersActive && filteredVulns.length === 0 && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No vulnerabilities match these filters. Loosen one or click <strong>Reset filters</strong>.
          </div>
        )}
      </div>

      {mode === 'compare' && (
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Before vs After applying real-world exploit signals</h2>
        <p className="mt-1 text-xs text-gray-500">
          Left = what the scanner alone says. Right = what you actually need to fix first once EPSS likelihood, CISA KEV, and business impact are factored in.
        </p>
        <div className="mt-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-900">
          <strong>How to read the arrows in the right table:</strong>{' '}
          <span className="inline-flex items-center gap-1 mx-1"><span className="text-green-700">▲ +3</span></span> means
          "this CVE jumped UP 3 places — fix it sooner than CVSS suggests" ·
          <span className="inline-flex items-center gap-1 mx-1"><span className="text-red-700">▼ -2</span></span> means
          "this CVE dropped DOWN 2 places — less urgent than CVSS alone implied".{' '}
          A CVE on KEV with high EPSS jumps up; a high-CVSS bug with EPSS &lt; 5% drops down because nobody's exploiting it.
        </div>
      </div>
      )}

      {/* Side-by-side ranking panels — only in compare mode */}
      {mode === 'compare' && (
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        {/* LEFT — CVSS only (the "Before" view) */}
        <div className="rounded-lg border-2 border-gray-300 bg-gray-50 overflow-hidden">
          <div className="bg-gray-200 px-4 py-2.5 border-b-2 border-gray-300">
            <div className="text-[10px] uppercase tracking-wider font-bold text-gray-600">Before — Scanner CVSS only</div>
            <div className="text-sm font-semibold text-gray-900">What the scanner alone says</div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-100 text-gray-500">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">#</th>
                <th className="text-left px-3 py-1.5 font-medium">Vulnerability</th>
                <th className="text-right px-3 py-1.5 font-medium">CVSS</th>
              </tr>
            </thead>
            <tbody>
              {cvssSorted.map((v, i) => (
                <tr key={v.vuln_id} className="border-t border-gray-200">
                  <td className="px-3 py-2 font-mono font-semibold text-gray-700">#{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-[11px] text-gray-700">{v.cve_id || `VULN-${v.vuln_id}`}</div>
                    <div className="text-gray-500 truncate max-w-[14rem]">{v.title || 'Untitled'}</div>
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
        <div className="rounded-lg border-2 border-blue-400 bg-blue-50/40 overflow-hidden">
          <div className="bg-blue-100 px-4 py-2.5 border-b-2 border-blue-300">
            <div className="text-[10px] uppercase tracking-wider font-bold text-blue-700">After — Effective risk</div>
            <div className="text-sm font-semibold text-gray-900">CVSS + EPSS + KEV + Business impact</div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-blue-50 text-blue-700">
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
                  <tr key={v.vuln_id} className="border-t border-blue-100">
                    <td className="px-3 py-2 font-mono font-semibold text-blue-700">#{newRank}</td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[11px] text-gray-700">{v.cve_id || `VULN-${v.vuln_id}`}</div>
                      <div className="text-gray-500 truncate max-w-[14rem]">{v.title || 'Untitled'}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-block rounded px-1.5 py-0.5 font-mono font-semibold ${sevColor(v.band)}`}>
                        {(v.score * 10).toFixed(1)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {delta === 0 ? (
                        <span className="text-gray-400">·</span>
                      ) : delta > 0 ? (
                        <span className="text-green-700 font-semibold" title={`Moved up ${delta} from CVSS rank #${oldRank}`}>
                          ▲ +{delta}
                        </span>
                      ) : (
                        <span className="text-red-700 font-semibold" title={`Moved down ${-delta} from CVSS rank #${oldRank}`}>
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
                  <span className={moved > 0 ? 'text-green-800' : 'text-red-800'}>
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
      {mode === 'compare' && movers.length === 0 && filteredVulns.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-2.5 mb-4 text-xs text-gray-600">
          For these {filteredVulns.length} vulnerabilit{filteredVulns.length === 1 ? 'y' : 'ies'} the two lenses agree — same triage order either way.
        </div>
      )}

      {/* Detailed boxed breakdown — always sorted by Effective risk (the recommendation) */}
      <div className="border-t border-gray-200 pt-4 mt-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">
            Per-vulnerability detail —{' '}
            {mode === 'scanner' && 'sorted by Scanner CVSS'}
            {mode === 'effective' && `sorted by Effective risk${hideExploitSignals ? ' (no EPSS/KEV)' : ''}`}
            {mode === 'compare' && 'sorted by Effective risk (the recommendation)'}
          </h3>
          <Link href={`/assets/${asset.id}?tab=vulnerabilities`} className="text-xs text-blue-600 hover:underline">
            Manage vulnerability links →
          </Link>
        </div>
        <div className="space-y-3">
          {(mode === 'scanner' ? cvssSorted : effSorted).map((v, i) => {
            const newRank = i + 1;
            const otherRank = mode === 'scanner' ? (effRank.get(v.vuln_id) || 0) : (cvssRank.get(v.vuln_id) || 0);
            const otherLabel = mode === 'scanner' ? 'Effective' : 'CVSS';
            const delta = otherRank - newRank;
            const badgeBg = mode === 'scanner' ? 'bg-gray-700' : 'bg-blue-600';
            return (
              <div key={v.vuln_id}>
                <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-500">
                  <span className={`rounded ${badgeBg} text-white font-semibold px-1.5 py-0.5 text-[10px]`}>
                    #{newRank} by {mode === 'scanner' ? 'CVSS' : 'Effective'}
                  </span>
                  {delta === 0 ? (
                    <span className="text-gray-400">same as {otherLabel} rank</span>
                  ) : delta > 0 ? (
                    <span className="text-green-700">▲ moved up {delta} from {otherLabel} rank #{otherRank}</span>
                  ) : (
                    <span className="text-red-700">▼ moved down {-delta} from {otherLabel} rank #{otherRank}</span>
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
      <span className="text-xs text-gray-600">{label}</span>
      <span className={`font-mono text-xs ${known ? 'text-gray-900' : 'text-gray-400'}`}>
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
    <div className="rounded-md border border-gray-200">
      <div className={`flex items-center justify-between px-4 py-2 border-b border-gray-200 ${BAND_COLOR[v.band] || ''}`}>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-mono font-medium">{v.cve_id || `VULN-${v.vuln_id}`}</span>
          <span className="text-gray-700">{v.title || 'Untitled'}</span>
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
      <div className="px-4 pb-3 border-t border-dashed border-gray-200 pt-2 text-xs font-mono text-gray-700">
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
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-900 text-right">{v}</span>
    </div>
  );
}
