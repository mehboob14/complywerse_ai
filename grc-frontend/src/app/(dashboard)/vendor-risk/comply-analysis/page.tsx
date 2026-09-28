'use client';

// Comply analyses: one loss scenario at one supplier, taken apart factor by factor
// and simulated into the range of what a year could cost.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Download, Loader2, Plus, Upload, X } from 'lucide-react';
import { vendorFairApi, vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate } from '../_lib/tprmShared';
import { TIER_CLS, errText } from '../_lib/intake/types';
import { EFFECT_LABEL, LEVEL_CLS, download, money, pct, type FairAnalysis, type RiskLevel } from '../_lib/fair/shared';

interface Brief {
  id: number; name: string; vendor: { id: number; name: string }; p95: number | null; mean: number | null;
  chance: number | null; cover: number | null; risk_level: RiskLevel | null; status: string;
}
interface OverviewData {
  currency: string; count: number; finals: number; drafts: number; suppliers: number; average_year: number;
  largest: Brief[]; under_insured: Brief[]; no_cover: number; by_risk_level: Record<string, number>;
}

export default function FairPage() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');
  const [creating, setCreating] = useState<number | 'pick' | null>(null);
  const [importing, setImporting] = useState(false);
  const { data, isLoading, isError } = useQuery<{ items: FairAnalysis[]; currency: string }>({
    queryKey: ['tprm-fair'],
    queryFn: async () => (await vendorFairApi.list()).data,
    ...TPRM_QUERY_OPTS,
  });
  useEffect(() => {
    const vendor = Number(params?.get('vendor'));
    if (vendor) setCreating(vendor);
  }, [params]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Comply analyses</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
            One loss scenario at one supplier, taken apart factor by factor: how often a threat acts, how often that becomes a
            loss, and what each loss costs. Every factor is a range; thousands of simulated years show what a year could cost.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={async () => download((await vendorFairApi.exportAll()).data as Blob, 'comply-analyses.csv')}
            disabled={!data?.items.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download className="h-4 w-4" /> Export
          </button>
          {canEdit && (
            <>
              <button type="button" onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <Upload className="h-4 w-4" /> Import
              </button>
              <button type="button" onClick={() => setCreating('pick')} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700">
                <Plus className="h-4 w-4" /> New analysis
              </button>
            </>
          )}
        </div>
      </div>

      <Overview />

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <p className="text-sm text-rose-700">Could not load analyses.</p>
      ) : !data?.items.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          No analyses yet. Start one from a supplier; it is prefilled from what we already hold about it.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Analysis</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Scenario</th>
                <th className="px-4 py-2.5 text-right font-medium">Chance a year</th>
                <th className="px-4 py-2.5 text-right font-medium">Average year</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">1 year in 20</th>
                <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Least liability cap</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/vendor-risk/comply-analysis/${a.id}`} className="font-medium text-slate-900 hover:text-primary-700 hover:underline">{a.name}</Link>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      {a.vendor.name}
                      {a.vendor.tier && <span className={clsx('inline-flex rounded-full border px-1.5 text-[11px] capitalize', TIER_CLS[a.vendor.tier])}>{a.vendor.tier}</span>}
                      {a.status === 'final' && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] text-emerald-800">final</span>}
                    </p>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{EFFECT_LABEL[a.effect]}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{pct(a.annual?.chance)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">{money(a.annual?.mean, data.currency)}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums text-slate-700 sm:table-cell">{money(a.annual?.p95, data.currency)}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums text-slate-700 lg:table-cell">{money(a.liability_cap, data.currency)}</td>
                  <td className="hidden px-4 py-3 text-slate-500 lg:table-cell">{fmtDate(a.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating !== null && <NewAnalysis vendorId={creating === 'pick' ? null : creating} onClose={() => setCreating(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['tprm-fair'] })} />}
    </div>
  );
}

function Overview() {
  const { data } = useQuery({
    queryKey: ['tprm-fair', 'overview'],
    queryFn: async () => (await vendorFairApi.overview()).data as OverviewData,
    ...TPRM_QUERY_OPTS,
  });
  if (!data || !data.count) return null;
  const top = Math.max(...data.largest.map((b) => b.p95 || 0), 1);
  const stat = (label: string, value: string | number, note?: string, warn?: boolean) => (
    <div className={clsx('rounded-xl border p-4', warn ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white')}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat('Analyses', data.count, `${data.finals} final · ${data.drafts} draft`)}
        {stat('Suppliers analysed', data.suppliers)}
        {stat('Average year, final analyses', money(data.average_year, data.currency), 'Their average years added up')}
        {stat('Insurance short of the 1-in-20 year', data.under_insured.length,
          data.no_cover ? `${data.no_cover} with no cover recorded` : 'Every analysis has a cover recorded', data.under_insured.length > 0)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="fair-largest">
          <h2 id="fair-largest" className="mb-2 text-sm font-semibold text-slate-900">Largest one-in-twenty years</h2>
          <ul className="space-y-2">
            {data.largest.map((b) => (
              <li key={b.id}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/vendor-risk/comply-analysis/${b.id}`} className="min-w-0 truncate text-slate-800 hover:text-primary-700 hover:underline">
                    {b.name} <span className="text-xs text-slate-400">· {b.vendor.name}</span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {b.risk_level && <span className={clsx('rounded-full border px-1.5 text-[10px] font-semibold capitalize', LEVEL_CLS[b.risk_level])}>{b.risk_level}</span>}
                    <span className="tabular-nums text-slate-900">{money(b.p95, data.currency)}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${((b.p95 || 0) / top) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="fair-short">
          <h2 id="fair-short" className="mb-2 text-sm font-semibold text-slate-900">Where the supplier’s insurance falls short</h2>
          {data.under_insured.length === 0 ? (
            <p className="text-sm text-slate-500">
              {data.no_cover ? 'None of the covers recorded falls short. Record the others’ cover to check them too.' : 'Every supplier’s cover pays for its one-in-twenty year.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.under_insured.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <Link href={`/vendor-risk/comply-analysis/${b.id}`} className="min-w-0 truncate text-slate-800 hover:text-primary-700 hover:underline">
                    {b.vendor.name} <span className="text-xs text-slate-400">· {b.name}</span>
                  </Link>
                  <span className="shrink-0 text-xs text-amber-800">
                    covers {money(b.cover, data.currency)} of {money(b.p95, data.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function NewAnalysis({ vendorId, onClose }: { vendorId: number | null; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<number | ''>(vendorId ?? '');
  const [effect, setEffect] = useState<FairAnalysis['effect']>('confidentiality');
  const { data: vendors } = useQuery({
    queryKey: ['tprm-fair-vendors'],
    queryFn: async () => {
      const d = (await vendorRiskApi.getVendors({ limit: 500 })).data;
      return ((Array.isArray(d) ? d : d?.items || []) as Array<{ id: number; name: string }>).slice().sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const start = useMutation({
    mutationFn: async () => {
      const pre = (await vendorFairApi.prefill(Number(vendor), effect)).data as { inputs: object; notes: string[]; name: string };
      return (await vendorFairApi.create({ vendor_id: Number(vendor), effect, name: pre.name, inputs: pre.inputs, notes: pre.notes })).data as FairAnalysis;
    },
    onSuccess: (a) => router.push(`/vendor-risk/comply-analysis/${a.id}`),
    onError: (e) => toast({ type: 'error', title: 'Could not start the analysis', message: errText(e, 'Try again.') }),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="New Comply analysis"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl" onSubmit={(e) => { e.preventDefault(); start.mutate(); }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Comply analysis</h2>
            <p className="text-xs text-slate-500">It starts from what we hold about the supplier; every number says where it came from, and all of it can be changed.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <label className="block text-xs font-medium text-slate-700">Supplier
          <select required value={vendor} onChange={(e) => setVendor(e.target.value ? Number(e.target.value) : '')}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Choose a supplier</option>
            {(vendors || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <fieldset>
          <legend className="text-xs font-medium text-slate-700">What goes wrong</legend>
          <div className="mt-1 space-y-1.5">
            {(Object.keys(EFFECT_LABEL) as FairAnalysis['effect'][]).map((k) => (
              <label key={k} className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', effect === k ? 'border-primary-400 bg-primary-50' : 'border-slate-200')}>
                <input type="radio" name="effect" checked={effect === k} onChange={() => setEffect(k)} /> {EFFECT_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={!vendor || start.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {start.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Start
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ ready: number; problems: string[] } | null>(null);
  const check = useMutation({ mutationFn: async (f: File) => (await vendorFairApi.importFile(f, true)).data, onSuccess: setPreview });
  const run = useMutation({
    mutationFn: async () => (await vendorFairApi.importFile(file as File, false)).data as { ready: number },
    onSuccess: (r) => { onDone(); toast({ type: 'success', title: `${r.ready} analyses imported and run` }); onClose(); },
  });
  const error = check.error || run.error;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Import analyses"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Import analyses</h2>
            <p className="text-xs text-slate-500">One row per analysis: the supplier&apos;s name as on record, then a least, most likely and most value for each factor.
              {' '}<button type="button" onClick={async () => download((await vendorFairApi.template()).data as Blob, 'fair-analyses-template.csv')} className="text-primary-700 hover:underline">Download the template</button>.
              Nothing is written unless every row is sound.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <input ref={input} type="file" accept=".csv" className="hidden" aria-label="Analyses file"
          onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setPreview(null); if (f) check.mutate(f); e.target.value = ''; }} />
        <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-600 hover:bg-slate-50">
          {check.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5 text-slate-400" />}
          {file ? file.name : 'Choose a CSV file'}
        </button>
        {preview && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p><b>{preview.ready}</b> analyses ready.</p>
            {preview.problems.length > 0 && <ul className="mt-1 ml-4 list-disc text-xs text-rose-700">{preview.problems.slice(0, 10).map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        )}
        {error && <p className="text-sm text-rose-700">{errText(error, 'The file could not be imported')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => run.mutate()} disabled={!preview || preview.problems.length > 0 || !preview.ready || run.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {run.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Import and run
          </button>
        </div>
      </div>
    </div>
  );
}
