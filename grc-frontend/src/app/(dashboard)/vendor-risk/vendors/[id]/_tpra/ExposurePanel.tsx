'use client';

// Exposure — what this vendor could cost us in a year, always as a range, with
// the inputs that drove it and the assumptions behind them. The constants are
// the organisation's own, set in Settings; the numbers are reproducible.

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingDown } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../../../_lib/tprmQuery';

interface Year { chance: number; mean: number; p90: number; p95: number }
interface Scenario {
  key: string; label: string; active: boolean; note: string | null;
  per_year: Year; per_event: { p10: number; p50: number; p90: number };
  inputs: Array<{ factor: string; range: [number, number, number]; basis: string }>;
}
interface Exposure {
  currency: string; iterations: number; annual: Year; scenarios: Scenario[]; assumptions: string[];
  if_improved: { rating_from: string; rating_to: string; annual: Year } | null;
}

export default function ExposurePanel({ vendorId }: { vendorId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tprm-exposure', vendorId],
    queryFn: async () => (await tpraApi.vendorExposure(vendorId)).data as Exposure,
    ...TPRM_QUERY_OPTS,
  });
  if (isLoading) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Simulating…</p>;
  if (error || !data) return <p role="alert" className="text-sm text-red-600">The exposure could not be worked out.</p>;

  const money = (v: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: data.currency, maximumFractionDigits: 0 }).format(v);
  const value = (factor: string, v: number) => (/cost/i.test(factor) ? money(v)
    : v.toLocaleString('en-GB', { maximumFractionDigits: /year/i.test(factor) ? 3 : 0 }));
  const year = (y: Year) => [
    { label: 'Chance of a loss this year', value: `${Math.round(y.chance * 100)}%` },
    { label: 'Average year', value: money(y.mean) },
    { label: 'A bad year (1 in 10)', value: money(y.p90) },
    { label: 'A worse year (1 in 20)', value: money(y.p95) },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">What this vendor could cost us in a year</h2>
        <p className="mb-3 text-xs text-gray-500">
          A range from {data.iterations.toLocaleString('en-GB')} simulated years, not a forecast. The constants behind it
          are set in <Link href="/vendor-risk/settings" className="text-primary-700 hover:underline">Settings</Link>.
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {year(data.annual).map((t) => (
            <div key={t.label} className="rounded-lg border border-gray-100 p-3">
              <p className="text-[11px] text-gray-500">{t.label}</p>
              <p className="text-lg font-semibold text-slate-900">{t.value}</p>
            </div>
          ))}
        </div>
        {data.if_improved && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            If its residual rating improved from {data.if_improved.rating_from} to {data.if_improved.rating_to}, the average
            year would be {money(data.if_improved.annual.mean)} and the 1-in-20 year {money(data.if_improved.annual.p95)}.
          </p>
        )}
      </section>

      {data.scenarios.map((s) => (
        <section key={s.key} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{s.label}</h3>
            {s.active && (
              <p className="text-xs text-gray-600">
                If it happens: {money(s.per_event.p10)} to {money(s.per_event.p90)}, most often around {money(s.per_event.p50)}
              </p>
            )}
          </div>
          {s.note && <p className="mt-1 text-xs text-gray-500">{s.note}</p>}
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  {['Input', 'Least', 'Most likely', 'Most', 'Where it comes from'].map((c) => (
                    <th key={c} scope="col" className="px-2 py-1.5 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.inputs.map((i) => (
                  <tr key={i.factor} className="text-slate-800">
                    <td className="px-2 py-1.5">{i.factor}</td>
                    {i.range.map((v, j) => <td key={j} className="px-2 py-1.5 tabular-nums">{value(i.factor, v)}</td>)}
                    <td className="px-2 py-1.5 text-gray-600">{i.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Assumptions</h3>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-600">
          {data.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </section>
    </div>
  );
}
