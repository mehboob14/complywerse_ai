'use client';

// TPRM Admin / Settings (TPRM-006) — per-tenant program configuration the tiering
// & scoring engines actually read: inherent-risk factor weights, tier thresholds,
// and reassessment cadence. Previously hard-coded / not tunable.

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, RotateCcw, Loader2, AlertCircle, SlidersHorizontal, Gauge, CalendarClock } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';

interface ConfigResp {
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  cadence_days: Record<string, number>;
  defaults: { weights: Record<string, number>; thresholds: Record<string, number>; cadence_days: Record<string, number> };
  meta: { factor_keys: string[]; factor_labels: Record<string, string>; tier_keys: string[]; cadence_keys: string[] };
}

const inputCls = 'w-24 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-50';
const TIER_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function VendorRiskSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:config:edit') || hasPermission('erm:risks:edit');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tprm-config'],
    queryFn: async () => (await tpraApi.getConfig()).data as ConfigResp,
  });

  // Local editable form. Weights shown as percentages (normalized on save).
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [cadence, setCadence] = useState<Record<string, number>>({});

  const hydrate = (c: ConfigResp) => {
    setWeights(Object.fromEntries(c.meta.factor_keys.map((k) => [k, Math.round((c.weights[k] ?? 0) * 100)])));
    setThresholds({ ...c.thresholds });
    setCadence({ ...c.cadence_days });
  };
  useEffect(() => { if (data) hydrate(data); }, [data]);

  const save = useMutation({
    mutationFn: () => tpraApi.saveConfig({
      weights,           // percentages — backend normalizes to sum 1.0
      thresholds,
      cadence_days: cadence,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tprm-config'] }); toast({ type: 'success', title: 'Settings saved', message: 'New tiering runs use these values.' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  if (isLoading) return <div className="flex h-48 items-center justify-center"><PageLoader size="md" label="Loading settings…" /></div>;
  if (error || !data) {
    return (
      <div className="flex h-48 flex-col items-center justify-center text-red-500">
        <AlertCircle className="mb-2 h-7 w-7" /><p className="text-sm">Failed to load settings.</p>
        <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
      </div>
    );
  }

  const weightSum = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0);
  const thresholdsOk = thresholds.critical >= thresholds.high && thresholds.high >= thresholds.medium;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Settings className="h-5 w-5 text-slate-500" /> TPRM Settings</h1>
          <p className="text-sm text-gray-500">Tune the inherent-risk model, tier thresholds and reassessment cadence. New tiering &amp; scoring runs use these values.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => data && hydrate({ ...data, weights: data.defaults.weights, thresholds: data.defaults.thresholds, cadence_days: data.defaults.cadence_days })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !thresholdsOk}
              title={!thresholdsOk ? 'Thresholds must be Critical ≥ High ≥ Medium' : 'Save settings'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        )}
      </div>

      {!canEdit && (
        <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-700">You have read-only access — editing requires the <b>vendor_risk:config:edit</b> permission.</p>
      )}

      {/* Inherent-risk factor weights */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Inherent-risk factor weights</h3>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${Math.round(weightSum) === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>Total {Math.round(weightSum)}%</span>
        </div>
        <p className="mb-3 text-[11px] text-gray-500">How much each factor drives the inherent-risk score. Weights are normalized to 100% on save.</p>
        <div className="space-y-2">
          {data.meta.factor_keys.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">{data.meta.factor_labels[k] || k}</span>
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} max={100} className={inputCls} disabled={!canEdit}
                  value={weights[k] ?? 0}
                  onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tier thresholds */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Tier thresholds</h3>
          {!thresholdsOk && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600"><AlertCircle className="h-3 w-3" /> must be Critical ≥ High ≥ Medium</span>}
        </div>
        <p className="mb-3 text-[11px] text-gray-500">A 0–100 score at or above each threshold gets that tier (below Medium = Low). Drives assessment depth &amp; cadence.</p>
        <div className="space-y-2">
          {data.meta.tier_keys.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">{TIER_LABEL[k] || k}</span>
              <input type="number" min={0} max={100} className={inputCls} disabled={!canEdit}
                value={thresholds[k] ?? 0}
                onChange={(e) => setThresholds({ ...thresholds, [k]: Number(e.target.value) })} />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 text-gray-400">
            <span className="text-sm">Low</span><span className="text-xs">below Medium</span>
          </div>
        </div>
      </section>

      {/* Reassessment cadence */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Reassessment cadence</h3>
        </div>
        <p className="mb-3 text-[11px] text-gray-500">How often each tier is re-assessed, in days.</p>
        <div className="space-y-2">
          {data.meta.cadence_keys.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">{TIER_LABEL[k] || k}</span>
              <div className="flex items-center gap-1.5">
                <input type="number" min={1} className={inputCls} disabled={!canEdit}
                  value={cadence[k] ?? 365}
                  onChange={(e) => setCadence({ ...cadence, [k]: Number(e.target.value) })} />
                <span className="text-xs text-gray-400">days</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="text-[11px] text-gray-400">Integrations &amp; template defaults are managed elsewhere; questionnaire templates live under the Questionnaires tab.</p>
    </div>
  );
}
