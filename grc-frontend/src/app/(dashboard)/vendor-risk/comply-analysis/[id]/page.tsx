'use client';

// One Comply analysis: its factors as ranges, where the prefilled ones came from,
// and what thousands of simulated years say a year could cost.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, Download, Loader2, Trash2 } from 'lucide-react';
import { vendorFairApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { errText } from '../../_lib/intake/types';
import { EFFECT_LABEL, LossCurve, download, money, pct, type FairAnalysis, type FairInputs, type Triple } from '../../_lib/fair/shared';

type Row = { path: string; label: string; help: string; unit: 'events' | 'share' | 'money' };
const GROUPS: Array<{ title: string; rows: Row[] }> = [
  { title: 'How often it happens', rows: [
    { path: 'tef', label: 'Threat events a year', help: 'Serious attempts against this supplier that could lead to a loss.', unit: 'events' },
    { path: 'vulnerability', label: 'Chance an attempt becomes a loss', help: 'Vulnerability: how much of what is tried succeeds.', unit: 'share' },
  ] },
  { title: 'What each loss costs us', rows: [
    { path: 'primary.response', label: 'Response', help: 'Investigation, notification, legal and recovery work.', unit: 'money' },
    { path: 'primary.productivity', label: 'Productivity', help: 'Work that stops while the service or data is unavailable.', unit: 'money' },
    { path: 'primary.replacement', label: 'Replacement', help: 'Records, systems or data to replace or make good.', unit: 'money' },
  ] },
  { title: 'When others react', rows: [
    { path: 'secondary.probability', label: 'Chance regulators, customers or others react', help: 'Secondary loss event frequency, per loss.', unit: 'share' },
    { path: 'secondary.fines', label: 'Fines and judgments', help: 'Penalties, settlements and damages.', unit: 'money' },
    { path: 'secondary.reputation', label: 'Reputation', help: 'Customers lost or not won.', unit: 'money' },
    { path: 'secondary.competitive', label: 'Competitive advantage', help: 'Value of information competitors gain.', unit: 'money' },
  ] },
];

function get(inputs: FairInputs, path: string): Triple {
  return path.split('.').reduce((o: unknown, k) => (o as Record<string, unknown>)[k], inputs) as Triple;
}

function toText(inputs: FairInputs): Record<string, [string, string, string]> {
  const out: Record<string, [string, string, string]> = {};
  GROUPS.forEach((g) => g.rows.forEach((r) => {
    const t = get(inputs, r.path);
    out[r.path] = t.map((v) => String(r.unit === 'share' ? Math.round(v * 1000) / 10 : v)) as [string, string, string];
  }));
  return out;
}

function fromText(text: Record<string, [string, string, string]>, iterations: number): FairInputs {
  const t = (path: string, share: boolean) => text[path].map((v) => (Number(v) || 0) / (share ? 100 : 1)) as Triple;
  return {
    tef: t('tef', false), vulnerability: t('vulnerability', true),
    primary: { response: t('primary.response', false), productivity: t('primary.productivity', false), replacement: t('primary.replacement', false) },
    secondary: { probability: t('secondary.probability', true), fines: t('secondary.fines', false), reputation: t('secondary.reputation', false),
                 competitive: t('secondary.competitive', false) },
    iterations,
  };
}

export default function FairAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const analysisId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');
  const canDelete = hasPermission('vendor_risk:assessments:delete') || canEdit;
  const { data: a, isLoading, isError } = useQuery<FairAnalysis>({
    queryKey: ['tprm-fair', analysisId],
    queryFn: async () => (await vendorFairApi.get(analysisId)).data,
  });
  const [text, setText] = useState<Record<string, [string, string, string]> | null>(null);
  const [meta, setMeta] = useState({ name: '', scenario: '', asset: '', threat: '' });
  useEffect(() => {
    if (a?.inputs) {
      setText(toText(a.inputs));
      setMeta({ name: a.name, scenario: a.scenario || '', asset: a.asset || '', threat: a.threat || '' });
    }
  }, [a]);
  const dirty = useMemo(() => !!a?.inputs && !!text && (JSON.stringify(toText(a.inputs)) !== JSON.stringify(text)
    || meta.name !== a.name || meta.scenario !== (a.scenario || '') || meta.asset !== (a.asset || '') || meta.threat !== (a.threat || '')), [a, text, meta]);
  const save = useMutation({
    mutationFn: async (extra: Record<string, unknown> = {}) => (await vendorFairApi.update(analysisId, {
      inputs: fromText(text!, a!.inputs!.iterations), name: meta.name, scenario: meta.scenario, asset: meta.asset, threat: meta.threat,
      row_version: a!.row_version, ...extra,
    })).data as FairAnalysis,
    onSuccess: (r) => { qc.setQueryData(['tprm-fair', analysisId], r); qc.invalidateQueries({ queryKey: ['tprm-fair'] }); toast({ type: 'success', title: 'Saved and run again' }); },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
  });
  const remove = useMutation({
    mutationFn: () => vendorFairApi.remove(analysisId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tprm-fair'] }); router.push('/vendor-risk/comply-analysis'); },
  });

  if (isLoading || (a && !text)) return <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (isError || !a || !text) return <p className="text-sm text-rose-700">Could not load this analysis.</p>;
  const r = a.result;
  const input = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums focus:border-primary-500 focus:outline-none disabled:bg-slate-50';

  return (
    <div className="space-y-5">
      <Link href="/vendor-risk/comply-analysis" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><ArrowLeft className="h-3.5 w-3.5" /> All analyses</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <input aria-label="Name" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} disabled={!canEdit}
            className="w-full max-w-xl rounded-md border border-transparent bg-transparent px-1 text-xl font-semibold text-slate-900 hover:border-slate-200 focus:border-primary-400 focus:outline-none" />
          <p className="mt-0.5 px-1 text-sm text-slate-500">
            <Link href={`/vendor-risk/vendors/${a.vendor.id}?tab=exposure`} className="text-primary-700 hover:underline">{a.vendor.name}</Link> · {EFFECT_LABEL[a.effect]}
            {a.status === 'final' && <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] text-emerald-800">final</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={async () => download((await vendorFairApi.exportOne(a.id)).data as Blob, `${a.name}.csv`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" /> CSV</button>
          {canEdit && (
            <button type="button" onClick={() => save.mutate({ status: a.status === 'final' ? 'draft' : 'final' })} disabled={save.isPending || dirty}
              title={dirty ? 'Save your changes first' : undefined}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {a.status === 'final' ? 'Back to draft' : 'Mark final'}
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={() => { if (window.confirm('Delete this analysis?')) remove.mutate(); }} aria-label="Delete analysis"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <form className="space-y-4 xl:col-span-2" onSubmit={(e) => { e.preventDefault(); save.mutate({}); }}>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <label className="block text-xs font-medium text-slate-700">The scenario
              <textarea rows={2} value={meta.scenario} onChange={(e) => setMeta({ ...meta, scenario: e.target.value })} disabled={!canEdit}
                placeholder="e.g. An attacker takes payroll records from the supplier's platform"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">What is at risk
                <input value={meta.asset} onChange={(e) => setMeta({ ...meta, asset: e.target.value })} disabled={!canEdit}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              </label>
              <label className="block text-xs font-medium text-slate-700">Who would act
                <input value={meta.threat} onChange={(e) => setMeta({ ...meta, threat: e.target.value })} disabled={!canEdit}
                  placeholder="e.g. Organised criminals" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              </label>
            </div>
          </section>

          {GROUPS.map((g) => (
            <section key={g.title} className="rounded-xl border border-slate-200 bg-white p-4" aria-label={g.title}>
              <div className="mb-2 grid grid-cols-[1fr_repeat(3,5.5rem)] items-end gap-2 text-[11px] uppercase tracking-wide text-slate-500">
                <span className="font-semibold">{g.title}</span><span className="text-right">Least</span><span className="text-right">Likely</span><span className="text-right">Most</span>
              </div>
              <div className="space-y-2.5">
                {g.rows.map((row) => (
                  <div key={row.path} className="grid grid-cols-[1fr_repeat(3,5.5rem)] items-center gap-2">
                    <div>
                      <p className="text-sm text-slate-800">{row.label}{row.unit === 'share' ? ' (%)' : row.unit === 'money' ? ` (${a.currency})` : ''}</p>
                      <p className="text-[11px] text-slate-400">{row.help}</p>
                    </div>
                    {[0, 1, 2].map((i) => (
                      <input key={i} type="number" min={0} step="any" max={row.unit === 'share' ? 100 : undefined} className={input} disabled={!canEdit}
                        aria-label={`${row.label}, ${['least', 'most likely', 'most'][i]}`} value={text[row.path][i]}
                        onChange={(e) => setText({ ...text, [row.path]: text[row.path].map((v, j) => (j === i ? e.target.value : v)) as [string, string, string] })} />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}

          {!!a.notes?.length && (
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Where the starting values came from</h3>
              <ul className="ml-4 list-disc space-y-0.5 text-xs text-slate-600">{a.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </section>
          )}
          {canEdit && (
            <div className="sticky bottom-0 flex justify-end gap-2 bg-gradient-to-t from-white via-white py-2">
              <button type="button" disabled={!dirty || save.isPending} onClick={() => { setText(toText(a.inputs!)); setMeta({ name: a.name, scenario: a.scenario || '', asset: a.asset || '', threat: a.threat || '' }); }}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Undo changes</button>
              <button type="submit" disabled={!dirty || save.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save and run
              </button>
            </div>
          )}
        </form>

        <div className={clsx('space-y-4 xl:col-span-3', dirty && 'opacity-60')} aria-live="polite">
          {r ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Tile label="Chance of a loss this year" value={pct(r.annual.chance)} note={`${r.lef.mean.toFixed(2)} losses a year on average`} />
                <Tile label="Average year" value={money(r.annual.mean, a.currency)} note="Annualized loss exposure" />
                <Tile label="One year in ten" value={money(r.annual.p90, a.currency)} />
                <Tile label="One year in twenty" value={money(r.annual.p95, a.currency)} />
                <Tile label="One year in a hundred" value={money(r.annual.p99, a.currency)} />
                <Tile label="Least liability cap to accept" value={money(r.liability_cap, a.currency)} note="The one-in-twenty year, rounded up" strong />
              </div>
              <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="fair-lec">
                <h2 id="fair-lec" className="text-sm font-semibold text-slate-900">How likely a year costs at least…</h2>
                <p className="mb-2 text-xs text-slate-500">Loss exceedance curve from {r.iterations.toLocaleString()} simulated years.</p>
                <LossCurve points={r.lec} currency={a.currency}
                  marks={[{ loss: r.annual.p90, label: '1 in 10' }, { loss: r.annual.p95, label: '1 in 20' }]} />
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <p>A single loss costs {money(r.per_event.p10, a.currency)} to {money(r.per_event.p90, a.currency)} (80% of the time).</p>
                <p className="mt-1">Of the average year, {money(r.split.primary, a.currency)} is our own cost and {money(r.split.secondary, a.currency)} comes from others
                  reacting, which happens after {pct(r.split.secondary_share)} of losses.</p>
                <p className="mt-2 text-xs text-slate-400">Every factor is a range drawn as a PERT distribution; losses arrive independently at the drawn rate. The same inputs always give the same numbers.</p>
              </section>
            </>
          ) : <p className="text-sm text-slate-500">Save the inputs to run the analysis.</p>}
          {dirty && <p className="text-xs text-amber-700">These results are for the saved inputs. Save and run to see yours.</p>}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={clsx('rounded-xl border bg-white p-4', strong ? 'border-primary-200 bg-primary-50/40' : 'border-slate-200')}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}
