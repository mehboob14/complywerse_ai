'use client';

// The exposure model: the figures that put a money range on every supplier. Each input is a range (the lowest you would expect, the most likely, the highest), so every row says in words what its
// numbers mean. The page holds the values and saves them with the section's Save; changes are audited. The definitions and the rules are exposureModel.ts (tested); this file is the editor, on the kit.
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ErrorState, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { fieldClasses } from '@/components/ui/ds/fieldStyles';
import { tpraApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { COLUMNS, GROUPS, RATING_LABEL, SINGLES, exposureProblems, exposureSummary, inWords, num, ordered, type Quant, type Triple, type Unit } from './exposureModel';
import { Help } from './_ui';

export { exposureProblems, exposureSummary };
export type { Quant };

const NUM = `${fieldClasses(false)} h-ds-control px-[12px] text-right tabular-nums`;

function RangeRow({ label, value, unit, currency, disabled, onChange }: {
  label: string; value: Triple; unit: Unit; currency: string; disabled: boolean; onChange: (i: number, v: number) => void;
}) {
  const bad = !ordered(value);
  return (
    <div className="py-[6px] sm:grid sm:grid-cols-[minmax(0,1fr)_19rem] sm:items-center sm:gap-[12px]">
      <div className="min-w-0">
        <p className="text-ds-body text-ds-fg">{label}</p>
        <p className={clsx('text-ds-label', bad ? 'text-ds-danger' : 'text-ds-fg-muted')}>
          {bad ? 'Lowest, most likely and highest must go up in that order' : inWords(unit, value, currency)}
        </p>
      </div>
      <div className="mt-[4px] grid grid-cols-3 gap-[8px] sm:mt-0">
        {COLUMNS.map((col, i) => (
          <label key={col} className="block">
            <span className="mb-[2px] block text-ds-label text-ds-fg-muted sm:sr-only">{col}</span>
            <input type="number" min={0} step="any" value={value[i]} disabled={disabled} aria-label={`${label}: ${col.toLowerCase()}`} aria-invalid={bad || undefined}
              onChange={(e) => onChange(i, Number(e.target.value))} className={clsx(NUM, bad && '!border-ds-danger')} />
          </label>
        ))}
      </div>
    </div>
  );
}

function ColumnHeads() {
  return (
    <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_19rem] sm:gap-[12px]" aria-hidden>
      <span />
      <div className="grid grid-cols-3 gap-[8px] text-right text-ds-label text-ds-fg-muted">
        {COLUMNS.map((c) => <span key={c} className="pr-[8px]">{c}</span>)}
      </div>
    </div>
  );
}

const GROUP_BOX = 'mb-[16px] rounded-ds-control border border-ds-border p-[12px]';
const LEGEND = 'px-[4px] text-ds-body font-[600] text-ds-fg';

export default function ExposureSection({ value, onChange, canEdit }: { value: Quant; onChange: (next: Quant) => void; canEdit: boolean }) {
  const history = useQuery({
    queryKey: ['tprm-quant-history'],
    queryFn: async () => ((await tpraApi.quantificationHistory()).data?.items || []) as Array<{ at: string | null; by: string | null; was: Record<string, unknown>; now: Record<string, unknown> }>,
    ...TPRM_QUERY_OPTS,
  });
  const edit = (mutate: (next: Quant) => void) => {
    const next = JSON.parse(JSON.stringify(value)) as Quant;
    mutate(next);
    onChange(next);
  };
  const fmt = (v: unknown) => (Array.isArray(v) ? v.map((x) => num(Number(x))).join(' to ') : String(v));
  const rows = history.data ?? [];

  return (
    <div>
      <Help>
        These figures put a money range on every supplier (the Exposure tab on each supplier), feed the committee pack and prefill each new Comply analysis. Every input is a range: the <b>lowest</b> you would
        expect, the <b>most likely</b>, and the <b>highest</b>. The defaults are starting values for you to calibrate, not industry benchmarks.
      </Help>

      <div className="mb-[16px] flex flex-wrap gap-[16px]">
        <label className="flex items-center gap-[8px] text-ds-body text-ds-fg">Currency
          <input className={`${fieldClasses(false)} h-ds-control px-[12px] !w-[88px] uppercase`} maxLength={3} disabled={!canEdit} value={value.currency} onChange={(e) => edit((n) => { n.currency = e.target.value.toUpperCase(); })} />
        </label>
        <label className="text-ds-body text-ds-fg">
          <span className="flex items-center gap-[8px]">Simulated years per estimate
            <input type="number" min={1000} max={20000} step={1000} disabled={!canEdit} value={value.iterations} className={`${NUM} !w-[120px]`}
              onChange={(e) => edit((n) => { n.iterations = Number(e.target.value); })} />
          </span>
          <span className="mt-[2px] block text-ds-label text-ds-fg-muted">More years give steadier figures and take longer. 5,000 is plenty.</span>
        </label>
      </div>

      {GROUPS.map((g) => (
        <fieldset key={g.key} className={GROUP_BOX}>
          <legend className={LEGEND}>{g.title}</legend>
          <p className="mb-[8px] text-ds-label text-ds-fg-muted">{g.help}</p>
          <ColumnHeads />
          {Object.entries(value[g.key]).map(([band, triple]) => (
            <RangeRow key={band} label={g.bands[band] || band} value={triple} unit={g.unit} currency={value.currency} disabled={!canEdit} onChange={(i, v) => edit((n) => { n[g.key][band][i] = v; })} />
          ))}
        </fieldset>
      ))}

      <fieldset className={GROUP_BOX}>
        <legend className={LEGEND}>Costs and durations</legend>
        <p className="mb-[8px] text-ds-label text-ds-fg-muted">The same for every supplier.</p>
        <ColumnHeads />
        {SINGLES.map((s) => (
          <RangeRow key={s.key} label={s.title} value={value[s.key]} unit={s.unit} currency={value.currency} disabled={!canEdit} onChange={(i, v) => edit((n) => { n[s.key][i] = v; })} />
        ))}
      </fieldset>

      <fieldset className="rounded-ds-control border border-ds-border p-[12px]">
        <legend className={LEGEND}>How the assessment result changes how often incidents happen</legend>
        <p className="mb-[8px] text-ds-label text-ds-fg-muted">
          Incidents and outages a year are multiplied by this, by the supplier’s residual rating after assessment. 1 leaves them as they are, 2 doubles them (weak controls), 0.6 cuts them by 40% (strong controls).
        </p>
        <div className="grid gap-[8px] sm:grid-cols-5">
          {Object.entries(value.control_effect).map(([band, x]) => (
            <label key={band} className="block rounded-ds-control bg-ds-surface-subtle p-[8px] text-ds-label text-ds-fg-muted">
              {RATING_LABEL[band] || band}
              <span className="mt-[4px] flex items-center gap-[4px]">
                <span aria-hidden>×</span>
                <input type="number" min={0.05} max={10} step={0.1} disabled={!canEdit} value={x} aria-label={`Multiplier for a ${(RATING_LABEL[band] || band).toLowerCase()} residual rating`}
                  className={NUM} onChange={(e) => edit((n) => { n.control_effect[band] = Number(e.target.value); })} />
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {history.isLoading && <div className="mt-[16px]"><Skeleton className="h-[40px] w-full" /></div>}
      {history.isError && <div className="mt-[16px]"><ErrorState compact title="Couldn't load the change history" message={errorMessage(history.error)} onRetry={canRetry(history.error) ? () => { void history.refetch(); } : undefined} /></div>}
      {rows.length > 0 && (
        <details className="mt-[16px] rounded-ds-control border border-ds-border p-[12px]">
          <summary className="min-h-ds-control cursor-pointer text-ds-body font-[600] text-ds-fg">Change history ({rows.length})</summary>
          <ul className="m-0 mt-[8px] flex list-none flex-col gap-[6px] p-0 text-ds-body text-ds-fg-body">
            {rows.map((h, i) => (
              <li key={i}>
                <span className="text-ds-fg-muted">{h.at ? formatDateTime(h.at) : ''}{h.by ? `, ${h.by}` : ''}:</span>{' '}
                {Object.keys(h.now).map((k) => `${k.replace(/_/g, ' ')} ${fmt(h.was[k])} to ${fmt(h.now[k])}`).join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
