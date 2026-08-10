'use client';

/**
 * CRQM — FAIR quantification tab on the risk detail page.
 *
 * Gated by the risk's is_material flag (UI gate only — the API is open by
 * design). Flow: structured scenario → versioned loss model (ranges +
 * mandatory rationale) → seeded Monte Carlo run → loss exceedance curve /
 * tornado / control ROI comparison. Assumptions are rendered next to every
 * figure — the number without its reasoning is not the deliverable.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import {
  AlertTriangle, CheckCircle, Loader2, Play, Plus, Sparkles, Trash2, TrendingDown,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

interface Triple { min: number; ml: number; max: number }

interface LossComponent {
  key?: string | null;
  label: string;
  kind: 'primary' | 'secondary';
  min: number; ml: number; max: number;
  probability: number;
  rationale: string;
}

interface LossModel {
  id: number;
  risk_id: number;
  version: number;
  status: 'draft' | 'active' | 'archived' | string;
  currency: string;
  tef: Triple;
  pos: Triple;
  pos_basis?: string | null;
  components: LossComponent[];
  confidence_pct?: number | null;
  assumptions?: string | null;
  created_at?: string | null;
}

interface SimRun {
  id: number;
  status: string;
  iterations: number;
  seed: number;
  engine_version: string;
  currency?: string | null;
  ale_mean?: number | null;
  ale_median?: number | null;
  p5?: number | null; p50?: number | null; p90?: number | null;
  p95?: number | null; p99?: number | null;
  lec_points?: Array<{ loss: number; prob: number }>;
  component_contributions?: Array<{ key: string; label: string; mean_contribution: number }>;
  controls_scenario?: Array<{ control_link_id: number; label: string }> | null;
  assumptions_snapshot?: Record<string, unknown> | null;
  duration_ms?: number | null;
  created_at?: string | null;
}

interface LinkedControl { id: number; control_id: number; code: string; name: string }

interface PosSuggestion {
  available: boolean;
  reason?: string;
  band?: string;
  pos?: Triple;
  rule?: string;
  bands_table?: Record<string, { pos: Triple; rule: string }>;
  reasons?: string[];
  fingerprint?: string;
  generated_at?: string;
}

const EMPTY_COMPONENT: LossComponent = {
  label: '', kind: 'primary', min: 0, ml: 0, max: 0, probability: 1.0, rationale: '',
};

function fmtMoney(v: number | null | undefined, currency = 'USD'): string {
  if (v === null || v === undefined) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, maximumFractionDigits: 0, notation: v >= 1_000_000 ? 'compact' : 'standard',
    }).format(v);
  } catch {
    return `${currency} ${Math.round(v).toLocaleString()}`;
  }
}

function TripleInput({ label, value, onChange, disabled, step = 0.1 }: {
  label: string; value: Triple; onChange: (t: Triple) => void; disabled?: boolean; step?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <div className="grid grid-cols-3 gap-2">
        {(['min', 'ml', 'max'] as const).map((k) => (
          <div key={k}>
            <input
              type="number" step={step} min={0} disabled={disabled}
              value={Number.isFinite(value[k]) ? value[k] : ''}
              onChange={(e) => onChange({ ...value, [k]: parseFloat(e.target.value) || 0 })}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <p className="mt-0.5 text-[10px] text-slate-400 text-center">
              {k === 'ml' ? 'most likely' : k}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function QuantificationTab({ riskId, canEdit, linkedControls }: {
  riskId: number;
  canEdit: boolean;
  linkedControls: LinkedControl[];
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: scenario, isLoading: scenarioLoading } = useQuery({
    queryKey: ['crqm-scenario', riskId],
    queryFn: async () => (await ermApi.quantification.getScenario(riskId)).data,
  });

  const { data: modelsData } = useQuery({
    queryKey: ['crqm-models', riskId],
    queryFn: async () => (await ermApi.quantification.listLossModels(riskId)).data,
    enabled: !!scenario?.is_material,
  });
  const models: LossModel[] = modelsData?.models || [];
  const activeModel = models.find((m) => m.status === 'active') || null;
  const draftModel = models.find((m) => m.status === 'draft') || null;

  const { data: runsData } = useQuery({
    queryKey: ['crqm-runs', riskId],
    queryFn: async () => (await ermApi.quantification.listRuns(riskId)).data,
    enabled: !!scenario?.is_material,
  });
  const runs: SimRun[] = runsData?.runs || [];

  const [resultRun, setResultRun] = useState<SimRun | null>(null);
  const latestCompleted = useMemo(
    () => runs.find((r) => r.status === 'completed') || null, [runs],
  );
  useEffect(() => {
    if (!resultRun && latestCompleted) {
      ermApi.quantification.getRun(latestCompleted.id)
        .then((res) => setResultRun(res.data.run))
        .catch(() => undefined);
    }
  }, [latestCompleted, resultRun]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['crqm-scenario', riskId] });
    queryClient.invalidateQueries({ queryKey: ['crqm-models', riskId] });
    queryClient.invalidateQueries({ queryKey: ['crqm-runs', riskId] });
  };

  const scenarioMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => ermApi.quantification.updateScenario(riskId, data),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to save scenario'),
  });

  // ── scenario form state ────────────────────────────────────────────────────
  const [scenarioForm, setScenarioForm] = useState({
    scenario_actor: '', scenario_method: '', scenario_statement: '',
    effect_c: false, effect_i: false, effect_a: false,
  });
  useEffect(() => {
    if (scenario) {
      setScenarioForm({
        scenario_actor: scenario.scenario_actor || '',
        scenario_method: scenario.scenario_method || '',
        scenario_statement: scenario.scenario_statement || '',
        effect_c: !!scenario.scenario_effect?.confidentiality,
        effect_i: !!scenario.scenario_effect?.integrity,
        effect_a: !!scenario.scenario_effect?.availability,
      });
    }
  }, [scenario]);

  // ── loss-model editor state ────────────────────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<{
    currency: string; tef: Triple; pos: Triple; pos_basis: string;
    components: LossComponent[]; confidence_pct: number; assumptions: string;
  }>({
    currency: 'USD',
    tef: { min: 0.1, ml: 0.5, max: 1 },
    pos: { min: 0.1, ml: 0.3, max: 0.6 },
    pos_basis: '',
    components: [{ ...EMPTY_COMPONENT }],
    confidence_pct: 90,
    assumptions: '',
  });

  const openEditor = () => {
    const src = draftModel || activeModel || models[0];
    if (src) {
      setForm({
        currency: src.currency,
        tef: { ...src.tef },
        pos: { ...src.pos },
        pos_basis: src.pos_basis || '',
        components: (src.components || []).map((c) => ({ ...EMPTY_COMPONENT, ...c })),
        confidence_pct: src.confidence_pct ?? 90,
        assumptions: src.assumptions || '',
      });
    }
    setEditorOpen(true);
    setError(null);
  };

  const saveModelMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        currency: form.currency,
        tef: form.tef,
        pos: form.pos,
        pos_basis: form.pos_basis || null,
        components: form.components,
        confidence_pct: form.confidence_pct,
        assumptions: form.assumptions || null,
      };
      if (draftModel) return ermApi.quantification.updateLossModel(draftModel.id, payload);
      return ermApi.quantification.createLossModel(riskId, payload);
    },
    onSuccess: () => { setEditorOpen(false); setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to save loss model'),
  });

  const activateMutation = useMutation({
    mutationFn: (modelId: number) => ermApi.quantification.activateLossModel(modelId),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to activate'),
  });

  const simulateMutation = useMutation({
    mutationFn: (modelId: number) => ermApi.quantification.simulate(modelId, { iterations: 10000 }),
    onSuccess: (res) => { setResultRun(res.data.run); setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Simulation failed'),
  });

  // ── control ROI comparison state ──────────────────────────────────────────
  const [selectedLinks, setSelectedLinks] = useState<number[]>([]);
  const [effectEditor, setEffectEditor] = useState<number | null>(null);
  const [effectForm, setEffectForm] = useState<{ freq: Triple; mag: Triple; rationale: string }>({
    freq: { min: 0, ml: 0, max: 0 }, mag: { min: 0, ml: 0, max: 0 }, rationale: '',
  });
  const [comparison, setComparison] = useState<any>(null);

  const effectMutation = useMutation({
    mutationFn: (linkId: number) => ermApi.quantification.setControlEffect(linkId, {
      freq_reduction: effectForm.freq.max > 0 ? effectForm.freq : null,
      mag_reduction: effectForm.mag.max > 0 ? effectForm.mag : null,
      rationale: effectForm.rationale || null,
    }),
    onSuccess: () => { setEffectEditor(null); setError(null); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to save control effect'),
  });

  const comparisonMutation = useMutation({
    mutationFn: () => ermApi.quantification.controlComparison(riskId, {
      iterations: 10000, control_sets: [selectedLinks],
    }),
    onSuccess: (res) => { setComparison(res.data); setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Comparison failed'),
  });

  // ── PoS suggestion from CTEM evidence — on-demand, never on page load ─────
  const [suggestion, setSuggestion] = useState<PosSuggestion | null>(null);
  const [freshness, setFreshness] = useState<'unchanged' | 'changed' | null>(null);

  const suggestMutation = useMutation({
    mutationFn: async () => (await ermApi.quantification.getPosSuggestion(riskId)).data,
    onSuccess: (data: PosSuggestion) => { setSuggestion(data); setError(null); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not gather CTEM evidence'),
  });

  const acceptSuggestionMutation = useMutation({
    mutationFn: (modelId: number) => ermApi.quantification.acceptPosSuggestion(modelId),
    onSuccess: (res) => {
      const m = res.data?.model;
      if (m?.pos) {
        setForm((f) => ({ ...f, pos: { ...m.pos }, pos_basis: m.pos_basis || f.pos_basis }));
      }
      setSuggestion(null);
      setError(null);
      invalidate();
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not accept suggestion'),
  });

  const freshnessMutation = useMutation({
    mutationFn: async () => (await ermApi.quantification.getPosSuggestion(riskId)).data,
    onSuccess: (data: PosSuggestion) => {
      const frozen = (activeModel as any)?.pos_evidence?.fingerprint;
      setFreshness(data.available && frozen && data.fingerprint !== frozen ? 'changed' : 'unchanged');
    },
    onError: () => setFreshness(null),
  });

  if (scenarioLoading) {
    return <div className="flex items-center gap-2 py-10 justify-center text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" /> Loading quantification…
    </div>;
  }

  // ── material gate ─────────────────────────────────────────────────────────
  if (!scenario?.is_material) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-6 text-center">
        <p className="text-sm font-medium text-slate-800">This risk is not flagged as material</p>
        <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
          FAIR quantification works best on a small set (10–30) of well-formed, material
          scenarios. Flag this risk as material to build a loss model and simulate it in
          dollar terms. The flag is reversible and changes nothing else about the risk.
        </p>
        {canEdit && (
          <button
            onClick={() => scenarioMutation.mutate({ is_material: true })}
            disabled={scenarioMutation.isPending}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {scenarioMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Mark as material and quantify
          </button>
        )}
      </div>
    );
  }

  const currency = activeModel?.currency || form.currency || 'USD';

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* ── scenario ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Risk scenario</h3>
          {canEdit && (
            <button
              onClick={() => scenarioMutation.mutate({ is_material: false })}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Unflag material
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          A quantifiable scenario names who attacks what, to what effect, by what method —
          &quot;cyber risk&quot; alone cannot be modelled.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Threat actor</label>
            <input
              value={scenarioForm.scenario_actor} disabled={!canEdit}
              onChange={(e) => setScenarioForm((f) => ({ ...f, scenario_actor: e.target.value }))}
              placeholder="e.g. external ransomware operator"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
            <input
              value={scenarioForm.scenario_method} disabled={!canEdit}
              onChange={(e) => setScenarioForm((f) => ({ ...f, scenario_method: e.target.value }))}
              placeholder="e.g. compromised remote-access account"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <span className="text-xs font-medium text-slate-600">Effect:</span>
          {([['effect_c', 'Confidentiality'], ['effect_i', 'Integrity'], ['effect_a', 'Availability']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 text-xs text-slate-700">
              <input
                type="checkbox" disabled={!canEdit}
                checked={scenarioForm[k]}
                onChange={(e) => setScenarioForm((f) => ({ ...f, [k]: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600"
              />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">Scenario statement</label>
          <textarea
            value={scenarioForm.scenario_statement} disabled={!canEdit} rows={2}
            onChange={(e) => setScenarioForm((f) => ({ ...f, scenario_statement: e.target.value }))}
            placeholder="An external ransomware operator encrypts plant systems via a compromised remote-access account."
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        {canEdit && (
          <button
            onClick={() => scenarioMutation.mutate({
              scenario_actor: scenarioForm.scenario_actor || null,
              scenario_method: scenarioForm.scenario_method || null,
              scenario_statement: scenarioForm.scenario_statement || null,
              scenario_effect: {
                confidentiality: scenarioForm.effect_c,
                integrity: scenarioForm.effect_i,
                availability: scenarioForm.effect_a,
              },
            })}
            disabled={scenarioMutation.isPending}
            className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Save scenario
          </button>
        )}
      </section>

      {/* ── loss model ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Loss model
            {activeModel && (
              <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                v{activeModel.version} active
              </span>
            )}
            {draftModel && (
              <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                v{draftModel.version} draft
              </span>
            )}
          </h3>
          {canEdit && !editorOpen && (
            <button
              onClick={openEditor}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" /> {draftModel ? 'Edit draft' : 'New version'}
            </button>
          )}
        </div>

        {!editorOpen && !activeModel && !draftModel && (
          <p className="text-xs text-slate-500">
            No loss model yet. Estimates are always ranges (min / most-likely / max) with a
            written rationale — the reasoning is what gets defended later, not the number.
          </p>
        )}

        {!editorOpen && (activeModel || draftModel) && (() => {
          const m = activeModel || draftModel!;
          return (
            <div className="text-xs text-slate-600 space-y-1">
              <p>Event frequency: {m.tef.min}–{m.tef.max}/yr (most likely {m.tef.ml}) · success probability {Math.round(m.pos.min * 100)}–{Math.round(m.pos.max * 100)}% (ml {Math.round(m.pos.ml * 100)}%)</p>
              <p>{m.components.length} loss component(s) · currency {m.currency}{m.confidence_pct ? ` · ${m.confidence_pct}% confidence` : ''}</p>
              {m.pos_basis && <p className="text-slate-500">Probability basis: {m.pos_basis}</p>}
              {activeModel && (activeModel as any).pos_evidence && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => freshnessMutation.mutate()}
                    disabled={freshnessMutation.isPending}
                    className="text-[11px] text-primary-600 hover:text-primary-700 disabled:opacity-50"
                  >
                    {freshnessMutation.isPending ? 'Checking evidence…' : 'Check evidence freshness'}
                  </button>
                  {freshness === 'changed' && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      Evidence updated since estimate — restate in a new draft
                    </span>
                  )}
                  {freshness === 'unchanged' && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      Evidence unchanged
                    </span>
                  )}
                </div>
              )}
              {draftModel && canEdit && (
                <button
                  onClick={() => activateMutation.mutate(draftModel.id)}
                  disabled={activateMutation.isPending}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle className="h-3.5 w-3.5" /> Activate v{draftModel.version}
                </button>
              )}
            </div>
          );
        })()}

        {editorOpen && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TripleInput label="Event frequency (attempts / year)" value={form.tef}
                onChange={(t) => setForm((f) => ({ ...f, tef: t }))} />
              <TripleInput label="Probability of success (0–1)" value={form.pos} step={0.05}
                onChange={(t) => setForm((f) => ({ ...f, pos: t }))} />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
                <input
                  value={form.currency} maxLength={3}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                <label className="block text-xs font-medium text-slate-600 mb-1 mt-3">Confidence %</label>
                <input
                  type="number" min={0} max={100} value={form.confidence_pct}
                  onChange={(e) => setForm((f) => ({ ...f, confidence_pct: parseFloat(e.target.value) || 0 }))}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-600">Probability basis (where the estimate comes from)</label>
                <button
                  onClick={() => suggestMutation.mutate()}
                  disabled={suggestMutation.isPending}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                >
                  {suggestMutation.isPending
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Sparkles className="h-3 w-3" />}
                  Suggest from CTEM evidence
                </button>
              </div>
              <input
                value={form.pos_basis}
                onChange={(e) => setForm((f) => ({ ...f, pos_basis: e.target.value }))}
                placeholder="e.g. derived from validated attack paths on linked assets, or expert estimate"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
              {suggestion && !suggestion.available && (
                <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  {suggestion.reason}
                </p>
              )}
              {suggestion && suggestion.available && (
                <div className="mt-2 rounded-lg border border-primary-200 bg-primary-50/40 p-3 text-xs space-y-2">
                  <p className="font-medium text-slate-800">
                    Suggested: {Math.round((suggestion.pos?.min || 0) * 100)}–{Math.round((suggestion.pos?.max || 0) * 100)}%
                    (most likely {Math.round((suggestion.pos?.ml || 0) * 100)}%) — {suggestion.band} band
                  </p>
                  <div>
                    <p className="text-slate-600 font-medium mb-0.5">Why this range:</p>
                    <ul className="list-disc pl-4 text-slate-600 space-y-0.5">
                      {(suggestion.reasons || []).map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                  {suggestion.bands_table && (
                    <div>
                      <p className="text-slate-600 font-medium mb-0.5">The mapping table (conservative, fixed):</p>
                      <table className="w-full text-[11px]">
                        <tbody>
                          {Object.entries(suggestion.bands_table).map(([band, def]) => (
                            <tr key={band} className={band === suggestion.band ? 'font-medium text-slate-800' : 'text-slate-500'}>
                              <td className="py-0.5 pr-2 whitespace-nowrap">
                                {band}: {Math.round(def.pos.min * 100)}–{Math.round(def.pos.max * 100)}%
                              </td>
                              <td className="py-0.5">{def.rule}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => draftModel && acceptSuggestionMutation.mutate(draftModel.id)}
                      disabled={!draftModel || acceptSuggestionMutation.isPending}
                      title={!draftModel ? 'Save the draft first, then accept — the evidence snapshot is frozen onto the saved draft' : undefined}
                      className="rounded-lg bg-primary-600 px-3 py-1 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
                    >
                      {acceptSuggestionMutation.isPending ? 'Accepting…' : 'Accept into draft'}
                    </button>
                    {!draftModel && (
                      <span className="text-[11px] text-slate-500">Save the draft first — acceptance freezes the evidence snapshot onto it.</span>
                    )}
                    <button onClick={() => setSuggestion(null)} className="text-[11px] text-slate-400 hover:text-slate-600">
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-slate-600 mb-2">
                Loss components — each needs a range, an occurrence probability (a fine that
                materializes in ~15% of incidents is 0.15, not 1.0) and a rationale.
              </p>
              <div className="space-y-3">
                {form.components.map((c, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={c.label} placeholder="Component label (e.g. Production downtime)"
                        onChange={(e) => setForm((f) => {
                          const comps = [...f.components]; comps[i] = { ...comps[i], label: e.target.value };
                          return { ...f, components: comps };
                        })}
                        className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                      <select
                        value={c.kind}
                        onChange={(e) => setForm((f) => {
                          const comps = [...f.components]; comps[i] = { ...comps[i], kind: e.target.value as 'primary' | 'secondary' };
                          return { ...f, components: comps };
                        })}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      >
                        <option value="primary">Primary</option>
                        <option value="secondary">Secondary</option>
                      </select>
                      <div className="w-28">
                        <input
                          type="number" step={0.05} min={0} max={1} value={c.probability}
                          onChange={(e) => setForm((f) => {
                            const comps = [...f.components]; comps[i] = { ...comps[i], probability: parseFloat(e.target.value) || 0 };
                            return { ...f, components: comps };
                          })}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                          title="Per-incident occurrence probability (0–1)"
                        />
                        <p className="text-[10px] text-slate-400 text-center">occurrence prob.</p>
                      </div>
                      {form.components.length > 1 && (
                        <button
                          onClick={() => setForm((f) => ({ ...f, components: f.components.filter((_, j) => j !== i) }))}
                          className="text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <TripleInput
                      label={`Loss if it occurs (${form.currency})`} value={{ min: c.min, ml: c.ml, max: c.max }} step={1000}
                      onChange={(t) => setForm((f) => {
                        const comps = [...f.components]; comps[i] = { ...comps[i], ...t };
                        return { ...f, components: comps };
                      })}
                    />
                    <input
                      value={c.rationale} placeholder="Rationale — why these numbers (required)"
                      onChange={(e) => setForm((f) => {
                        const comps = [...f.components]; comps[i] = { ...comps[i], rationale: e.target.value };
                        return { ...f, components: comps };
                      })}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={() => setForm((f) => ({ ...f, components: [...f.components, { ...EMPTY_COMPONENT }] }))}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add component
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Model assumptions</label>
              <textarea
                value={form.assumptions} rows={2}
                onChange={(e) => setForm((f) => ({ ...f, assumptions: e.target.value }))}
                placeholder="Scope boundaries, exclusions, data sources…"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => saveModelMutation.mutate()}
                disabled={saveModelMutation.isPending}
                className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
              >
                {saveModelMutation.isPending ? 'Saving…' : (draftModel ? 'Save draft' : 'Create draft')}
              </button>
              <button
                onClick={() => { setEditorOpen(false); setError(null); }}
                className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── simulation ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Simulation</h3>
          {activeModel && canEdit && (
            <button
              onClick={() => simulateMutation.mutate(activeModel.id)}
              disabled={simulateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
            >
              {simulateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run 10,000 iterations
            </button>
          )}
        </div>

        {!activeModel && (
          <p className="text-xs text-slate-500">Activate a loss model to simulate.</p>
        )}

        {resultRun && resultRun.status === 'completed' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ['Expected annual loss', resultRun.ale_mean],
                ['Median year', resultRun.ale_median],
                ['Bad year (p95)', resultRun.p95],
                ['Extreme year (p99)', resultRun.p99],
              ].map(([label, v]) => (
                <div key={label as string} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-center">
                  <p className="text-lg font-bold text-slate-900 tabular-nums">
                    {fmtMoney(v as number, resultRun.currency || currency)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-medium text-slate-600 mb-1">
                Loss exceedance curve — chance per year of losing more than a given amount
              </p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={resultRun.lec_points || []} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="loss" type="number" domain={['dataMin', 'dataMax']}
                      tickFormatter={(v) => fmtMoney(v, resultRun.currency || currency)}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(v) => `${Math.round(v * 100)}%`}
                      domain={[0, 'dataMax']} tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value) => [`${(Number(value) * 100).toFixed(1)}%`, 'P(loss exceeds)']}
                      labelFormatter={(v) => fmtMoney(Number(v), resultRun.currency || currency)}
                    />
                    <Area type="monotone" dataKey="prob" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {(resultRun.component_contributions || []).length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-600 mb-1">Loss drivers (mean annual contribution)</p>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={resultRun.component_contributions || []} layout="vertical"
                      margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                    >
                      <XAxis type="number" tickFormatter={(v) => fmtMoney(v, resultRun.currency || currency)} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value) => [fmtMoney(Number(value), resultRun.currency || currency), 'mean / year']} />
                      <Bar dataKey="mean_contribution" fill="#0ea5e9" radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <p className="text-[11px] text-slate-400">
              Run #{resultRun.id} · {resultRun.iterations.toLocaleString()} iterations · seed {resultRun.seed} ·
              engine {resultRun.engine_version} — reproducible bit-for-bit from these parameters.
              {(resultRun.assumptions_snapshot as any)?.model?.assumptions && (
                <> Assumptions: {(resultRun.assumptions_snapshot as any).model.assumptions}</>
              )}
            </p>
          </div>
        )}
      </section>

      {/* ── control ROI ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Control ROI comparison</h3>
        <p className="text-xs text-slate-500 mb-3">
          Model each linked control&apos;s effect (how much it reduces event frequency and/or
          loss magnitude), select controls, and re-simulate — same seed as the baseline, so
          the delta is the control&apos;s effect and nothing else.
        </p>
        {linkedControls.length === 0 && (
          <p className="text-xs text-slate-500">No controls linked to this risk yet — link controls on the Controls tab first.</p>
        )}
        <div className="space-y-2">
          {linkedControls.map((lc) => (
            <div key={lc.id} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedLinks.includes(lc.id)}
                  onChange={(e) => setSelectedLinks((prev) =>
                    e.target.checked ? [...prev, lc.id] : prev.filter((x) => x !== lc.id))}
                  className="h-4 w-4 rounded border-slate-300 text-primary-600"
                />
                <span className="text-sm text-slate-800 flex-1">{lc.code} — {lc.name}</span>
                {canEdit && (
                  <button
                    onClick={() => { setEffectEditor(effectEditor === lc.id ? null : lc.id); }}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    {effectEditor === lc.id ? 'Close' : 'Model effect'}
                  </button>
                )}
              </div>
              {effectEditor === lc.id && (
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <TripleInput label="Frequency reduction (%)" value={effectForm.freq} step={5}
                      onChange={(t) => setEffectForm((f) => ({ ...f, freq: t }))} />
                    <TripleInput label="Magnitude reduction (%)" value={effectForm.mag} step={5}
                      onChange={(t) => setEffectForm((f) => ({ ...f, mag: t }))} />
                  </div>
                  <input
                    value={effectForm.rationale}
                    onChange={(e) => setEffectForm((f) => ({ ...f, rationale: e.target.value }))}
                    placeholder="Why these percentages (required for defensibility)"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => effectMutation.mutate(lc.id)}
                    disabled={effectMutation.isPending}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Save effect
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {linkedControls.length > 0 && (
          <button
            onClick={() => comparisonMutation.mutate()}
            disabled={comparisonMutation.isPending || selectedLinks.length === 0 || !activeModel}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {comparisonMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingDown className="h-3.5 w-3.5" />}
            Compare selected vs baseline
          </button>
        )}
        {comparison && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm">
            <p className="text-slate-800">
              Baseline expected annual loss:{' '}
              <span className="font-semibold">{fmtMoney(comparison.baseline?.ale_mean, currency)}</span>
            </p>
            {(comparison.options || []).map((opt: any, i: number) => (
              <p key={i} className="mt-1 text-slate-800">
                With selected control(s):{' '}
                <span className="font-semibold">{fmtMoney(opt.run?.ale_mean, currency)}</span>
                {opt.ale_reduction != null && (
                  <span className="ml-2 text-emerald-700">
                    − {fmtMoney(opt.ale_reduction, currency)} / year
                  </span>
                )}
                {!opt.has_modelled_effect && (
                  <span className="ml-2 text-amber-700 text-xs">
                    (no modelled effect — equals baseline by construction)
                  </span>
                )}
              </p>
            ))}
            {comparison.note && <p className="mt-2 text-xs text-amber-700">{comparison.note}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
