'use client';

// The exposure model's constants. Every value is a range (least, most likely,
// most); the defaults are starting values to calibrate, not benchmarks. Saved on
// its own, and every change is recorded with who made it and what moved.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Loader2, RotateCcw, Save } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';

type Triple = [number, number, number];
export interface Quant {
  currency: string; iterations: number;
  breach_per_year: Record<string, Triple>; outage_per_year: Record<string, Triple>; records: Record<string, Triple>;
  outage_cost_per_hour: Record<string, Triple>; cost_per_record: Triple; response_cost: Triple; outage_hours: Triple;
  control_effect: Record<string, number>;
}
type GroupKey = 'breach_per_year' | 'outage_per_year' | 'records' | 'outage_cost_per_hour';
type SingleKey = 'cost_per_record' | 'response_cost' | 'outage_hours';

const GROUPS: Array<{ key: GroupKey; title: string }> = [
  { key: 'breach_per_year', title: 'Data exposures a year, by tier' },
  { key: 'outage_per_year', title: 'Outages a year, by tier' },
  { key: 'records', title: 'Records exposed in one event, by the data the vendor can reach' },
  { key: 'outage_cost_per_hour', title: 'Cost of an hour of outage, by the criticality of the process that stops' },
];
const SINGLES: Array<{ key: SingleKey; title: string }> = [
  { key: 'cost_per_record', title: 'Cost per record exposed' },
  { key: 'response_cost', title: 'Response cost per event (investigation, notification, legal)' },
  { key: 'outage_hours', title: 'Hours an outage lasts' },
];
const numCls = 'w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-right text-sm disabled:bg-gray-50';
const fmt = (v: unknown) => (Array.isArray(v) ? v.map((x) => Number(x).toLocaleString('en-GB')).join(' – ') : String(v));

function TripleInputs({ label, value, disabled, onChange }: {
  label: string; value: Triple; disabled: boolean; onChange: (i: number, v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
      <span className="text-sm text-slate-700">{label}</span>
      <span className="flex items-center gap-1.5">
        {(['least', 'most likely', 'most'] as const).map((part, i) => (
          <input key={part} type="number" min={0} step="any" className={numCls} disabled={disabled} value={value[i]}
            aria-label={`${label}, ${part}`} onChange={(e) => onChange(i, Number(e.target.value))} />
        ))}
      </span>
    </div>
  );
}

export default function ExposureModel({ initial, defaults, canEdit }: { initial: Quant; defaults: Quant; canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState<Quant>(initial);
  useEffect(() => setQ(initial), [initial]);
  const { data: history } = useQuery({
    queryKey: ['tprm-quant-history'],
    queryFn: async () => ((await tpraApi.quantificationHistory()).data?.items || []) as
      Array<{ at: string | null; by: string | null; was: Record<string, unknown>; now: Record<string, unknown> }>,
    ...TPRM_QUERY_OPTS,
  });

  const edit = (mutate: (next: Quant) => void) => setQ((prev) => {
    const next = JSON.parse(JSON.stringify(prev)) as Quant;
    mutate(next);
    return next;
  });
  const save = useMutation({
    mutationFn: () => tpraApi.saveConfig({ quantification: q }),
    onSuccess: () => {
      ['tprm-config', 'tprm-quant-history', 'tprm-exposure'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast({ type: 'success', title: 'Exposure model saved', message: 'Every exposure figure now uses these values.' });
    },
    onError: (e) => toast({
      type: 'error', title: 'Could not save',
      message: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Try again.',
    }),
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Coins className="h-4 w-4 text-primary-600" /> Exposure model</h3>
        {canEdit && (
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => setQ(JSON.parse(JSON.stringify(defaults)))}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600">
              <RotateCcw className="h-3.5 w-3.5" /> Defaults
            </button>
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save model
            </button>
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] text-gray-500">
        Each value is a range: least, most likely and most. The defaults are starting values for you to calibrate, not
        industry benchmarks. A vendor&apos;s Exposure tab shows the range these produce and which inputs drove it.
      </p>

      <div className="mb-3 flex flex-wrap gap-4">
        <label className="text-sm text-slate-700">Currency{' '}
          <input className="ml-1 w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm uppercase disabled:bg-gray-50" maxLength={3}
            disabled={!canEdit} value={q.currency} onChange={(e) => edit((n) => { n.currency = e.target.value.toUpperCase(); })} />
        </label>
        <label className="text-sm text-slate-700">Simulated years{' '}
          <input type="number" min={1000} max={20000} step={1000} className={numCls} disabled={!canEdit} value={q.iterations}
            onChange={(e) => edit((n) => { n.iterations = Number(e.target.value); })} />
        </label>
      </div>

      {GROUPS.map((g) => (
        <fieldset key={g.key} className="mb-3 border-t border-gray-100 pt-2">
          <legend className="text-xs font-medium text-gray-600">{g.title}</legend>
          {Object.entries(q[g.key]).map(([band, triple]) => (
            <TripleInputs key={band} label={band.charAt(0).toUpperCase() + band.slice(1)} value={triple} disabled={!canEdit}
              onChange={(i, v) => edit((n) => { n[g.key][band][i] = v; })} />
          ))}
        </fieldset>
      ))}
      <fieldset className="mb-3 border-t border-gray-100 pt-2">
        <legend className="text-xs font-medium text-gray-600">Costs and durations</legend>
        {SINGLES.map((s) => (
          <TripleInputs key={s.key} label={s.title} value={q[s.key]} disabled={!canEdit}
            onChange={(i, v) => edit((n) => { n[s.key][i] = v; })} />
        ))}
      </fieldset>
      <fieldset className="border-t border-gray-100 pt-2">
        <legend className="text-xs font-medium text-gray-600">How the residual rating scales how often events happen</legend>
        <div className="flex flex-wrap gap-3 py-1">
          {Object.entries(q.control_effect).map(([band, x]) => (
            <label key={band} className="text-sm text-slate-700">{band.charAt(0).toUpperCase() + band.slice(1)} ×{' '}
              <input type="number" min={0.05} max={10} step={0.1} className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm disabled:bg-gray-50"
                disabled={!canEdit} value={x} onChange={(e) => edit((n) => { n.control_effect[band] = Number(e.target.value); })} />
            </label>
          ))}
        </div>
      </fieldset>

      {(history || []).length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <p className="mb-1 text-xs font-medium text-gray-600">Changes</p>
          <ul className="space-y-1 text-[11px] text-gray-600">
            {history!.map((h, i) => (
              <li key={i}>
                <span className="text-gray-500">{h.at ? new Date(h.at).toLocaleString('en-GB') : ''}{h.by ? `, ${h.by}` : ''}:</span>{' '}
                {Object.keys(h.now).map((k) => `${k.replace(/_/g, ' ')} ${fmt(h.was[k])} → ${fmt(h.now[k])}`).join('; ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
