'use client';

// The exposure model: the figures that put a money range on every supplier.
// Each input is a range (the lowest you would expect, the most likely, the
// highest), so every row says in words what its numbers mean. The page holds
// the values and saves them with the other sections; changes are audited.

import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { tpraApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { Help } from './_ui';

export type Triple = [number, number, number];
export interface Quant {
  currency: string; iterations: number;
  breach_per_year: Record<string, Triple>; outage_per_year: Record<string, Triple>; records: Record<string, Triple>;
  outage_cost_per_hour: Record<string, Triple>; cost_per_record: Triple; response_cost: Triple; outage_hours: Triple;
  control_effect: Record<string, number>;
}
type GroupKey = 'breach_per_year' | 'outage_per_year' | 'records' | 'outage_cost_per_hour';
type SingleKey = 'cost_per_record' | 'response_cost' | 'outage_hours';
type Unit = 'rate' | 'records' | 'money' | 'money_hour' | 'hours';

const TIER_BANDS: Record<string, string> = { critical: 'Critical-tier supplier', high: 'High-tier supplier', medium: 'Medium-tier supplier', low: 'Low-tier supplier' };
const ACCESS_BANDS: Record<string, string> = {
  none: 'No access to our data', public: 'Public data only', internal: 'Internal data', confidential: 'Confidential data',
  restricted: 'Restricted data', regulated: 'Regulated data',
};
const PROCESS_BANDS: Record<string, string> = {
  critical: 'A critical process stops', high: 'A high-criticality process stops', medium: 'A medium-criticality process stops',
  low: 'A low-criticality process stops',
};
const GROUPS: Array<{ key: GroupKey; title: string; help: string; bands: Record<string, string>; unit: Unit }> = [
  { key: 'breach_per_year', title: 'How often a supplier exposes our data', unit: 'rate', bands: TIER_BANDS,
    help: 'Incidents a year at one supplier, by its tier. 0.1 means about once in ten years; 1 means about once a year.' },
  { key: 'outage_per_year', title: 'How often a supplier’s service stops', unit: 'rate', bands: TIER_BANDS,
    help: 'Outages a year at one supplier, by its tier.' },
  { key: 'records', title: 'How many of our records one incident exposes', unit: 'records', bands: ACCESS_BANDS,
    help: 'By the most sensitive data the supplier can reach, as recorded on the supplier.' },
  { key: 'outage_cost_per_hour', title: 'What an hour of outage costs us', unit: 'money_hour', bands: PROCESS_BANDS,
    help: 'By the most critical business process that depends on the supplier, from business continuity planning.' },
];
const SINGLES: Array<{ key: SingleKey; title: string; unit: Unit }> = [
  { key: 'cost_per_record', title: 'Cost for each record exposed', unit: 'money' },
  { key: 'response_cost', title: 'Cost of handling one incident: investigation, notification, legal', unit: 'money' },
  { key: 'outage_hours', title: 'How long an outage lasts', unit: 'hours' },
];
const RATING_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', unrated: 'Not yet rated' };
const COLUMNS = ['Lowest', 'Most likely', 'Highest'] as const;
const numCls = 'w-full rounded-lg border bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50 disabled:text-slate-500';

const num = (v: number) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 3 });
const ordered = (t: Triple) => t[0] <= t[1] && t[1] <= t[2] && t[0] >= 0;

function inWords(unit: Unit, t: Triple, currency: string): string {
  const m = Number(t[1]) || 0;
  switch (unit) {
    case 'rate':
      if (m <= 0) return 'most likely never';
      if (m < 1) return `most likely about once every ${num(Math.round(1 / m))} years`;
      return m === 1 ? 'most likely about once a year' : `most likely about ${num(m)} times a year`;
    case 'records': return m ? `most likely ${num(m)} records` : 'most likely none';
    case 'money': return `most likely ${currency} ${num(m)}`;
    case 'money_hour': return `most likely ${currency} ${num(m)} an hour`;
    default: return `most likely ${num(m)} hours`;
  }
}

/** Ranges that do not go up from lowest to highest, by name, for the save bar. */
export function exposureProblems(q: Quant): string[] {
  const out: string[] = [];
  GROUPS.forEach((g) => Object.entries(q[g.key]).forEach(([band, t]) => { if (!ordered(t)) out.push(`${g.bands[band] || band}: ${g.title.toLowerCase()}`); }));
  SINGLES.forEach((s) => { if (!ordered(q[s.key])) out.push(s.title); });
  return out;
}

export const exposureSummary = (q: Quant) =>
  `${q.currency} · ${Number(q.iterations).toLocaleString('en-GB')} simulated years · incidents, outages, records and costs as ranges`;

function RangeRow({ label, value, unit, currency, disabled, onChange }: {
  label: string; value: Triple; unit: Unit; currency: string; disabled: boolean; onChange: (i: number, v: number) => void;
}) {
  const bad = !ordered(value);
  return (
    <div className="py-1.5 sm:grid sm:grid-cols-[minmax(0,1fr)_19rem] sm:items-center sm:gap-3">
      <div className="min-w-0">
        <p className="text-sm text-slate-700">{label}</p>
        <p className={clsx('text-[11px]', bad ? 'text-rose-600' : 'text-slate-400')}>
          {bad ? 'Lowest, most likely and highest must go up in that order' : inWords(unit, value, currency)}
        </p>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 sm:mt-0">
        {COLUMNS.map((col, i) => (
          <label key={col} className="block">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:sr-only">{col}</span>
            <input type="number" min={0} step="any" value={value[i]} disabled={disabled} aria-label={`${label}: ${col.toLowerCase()}`}
              onChange={(e) => onChange(i, Number(e.target.value))}
              className={clsx(numCls, bad ? 'border-rose-300' : 'border-slate-300 focus:border-primary-500')} />
          </label>
        ))}
      </div>
    </div>
  );
}

function ColumnHeads() {
  return (
    <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_19rem] sm:gap-3" aria-hidden>
      <span />
      <div className="grid grid-cols-3 gap-2 text-right text-[11px] font-medium text-slate-500">
        {COLUMNS.map((c) => <span key={c} className="pr-2">{c}</span>)}
      </div>
    </div>
  );
}

export default function ExposureSection({ value, onChange, canEdit }: {
  value: Quant; onChange: (next: Quant) => void; canEdit: boolean;
}) {
  const { data: history } = useQuery({
    queryKey: ['tprm-quant-history'],
    queryFn: async () => ((await tpraApi.quantificationHistory()).data?.items || []) as
      Array<{ at: string | null; by: string | null; was: Record<string, unknown>; now: Record<string, unknown> }>,
    ...TPRM_QUERY_OPTS,
  });
  const edit = (mutate: (next: Quant) => void) => {
    const next = JSON.parse(JSON.stringify(value)) as Quant;
    mutate(next);
    onChange(next);
  };
  const fmt = (v: unknown) => (Array.isArray(v) ? v.map((x) => num(Number(x))).join(' – ') : String(v));

  return (
    <div>
      <Help>
        These figures put a money range on every supplier (the Exposure tab on each supplier), feed the committee pack and
        prefill each new Comply analysis. Every input is a range: the <b>lowest</b> you would expect, the <b>most likely</b>,
        and the <b>highest</b>. The defaults are starting values for you to calibrate, not industry benchmarks.
      </Help>

      <div className="mb-4 flex flex-wrap gap-4">
        <label className="text-sm text-slate-700">Currency
          <input className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm uppercase disabled:bg-slate-50" maxLength={3}
            disabled={!canEdit} value={value.currency} onChange={(e) => edit((n) => { n.currency = e.target.value.toUpperCase(); })} />
        </label>
        <label className="text-sm text-slate-700">Simulated years per estimate
          <input type="number" min={1000} max={20000} step={1000} disabled={!canEdit} value={value.iterations}
            className="ml-2 w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm disabled:bg-slate-50"
            onChange={(e) => edit((n) => { n.iterations = Number(e.target.value); })} />
          <span className="mt-0.5 block text-[11px] text-slate-400">More years give steadier figures and take longer. 5,000 is plenty.</span>
        </label>
      </div>

      {GROUPS.map((g) => (
        <fieldset key={g.key} className="mb-4 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-800">{g.title}</legend>
          <p className="mb-2 text-[11px] text-slate-500">{g.help}</p>
          <ColumnHeads />
          {Object.entries(value[g.key]).map(([band, triple]) => (
            <RangeRow key={band} label={g.bands[band] || band} value={triple} unit={g.unit} currency={value.currency} disabled={!canEdit}
              onChange={(i, v) => edit((n) => { n[g.key][band][i] = v; })} />
          ))}
        </fieldset>
      ))}

      <fieldset className="mb-4 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-800">Costs and durations</legend>
        <p className="mb-2 text-[11px] text-slate-500">The same for every supplier.</p>
        <ColumnHeads />
        {SINGLES.map((s) => (
          <RangeRow key={s.key} label={s.title} value={value[s.key]} unit={s.unit} currency={value.currency} disabled={!canEdit}
            onChange={(i, v) => edit((n) => { n[s.key][i] = v; })} />
        ))}
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-800">How the assessment result changes how often incidents happen</legend>
        <p className="mb-2 text-[11px] text-slate-500">
          Incidents and outages a year are multiplied by this, by the supplier’s residual rating after assessment. 1 leaves
          them as they are, 2 doubles them (weak controls), 0.6 cuts them by 40% (strong controls).
        </p>
        <div className="grid gap-2 sm:grid-cols-5">
          {Object.entries(value.control_effect).map(([band, x]) => (
            <label key={band} className="block rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
              {RATING_LABEL[band] || band}
              <span className="mt-1 flex items-center gap-1">
                <span className="text-slate-400">×</span>
                <input type="number" min={0.05} max={10} step={0.1} disabled={!canEdit} value={x}
                  aria-label={`Multiplier for a ${(RATING_LABEL[band] || band).toLowerCase()} residual rating`}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums disabled:bg-slate-50"
                  onChange={(e) => edit((n) => { n.control_effect[band] = Number(e.target.value); })} />
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {(history || []).length > 0 && (
        <details className="mt-4 rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Change history ({history!.length})</summary>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
            {history!.map((h, i) => (
              <li key={i}>
                <span className="text-slate-500">{h.at ? new Date(h.at).toLocaleString('en-GB') : ''}{h.by ? `, ${h.by}` : ''}:</span>{' '}
                {Object.keys(h.now).map((k) => `${k.replace(/_/g, ' ')} ${fmt(h.was[k])} → ${fmt(h.now[k])}`).join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
