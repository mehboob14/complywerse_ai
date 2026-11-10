'use client';

// Comply analysis > Result: what the simulation says a year could cost. Every figure is the server's (tpra/fair.py) for the SAVED inputs: when the form holds changes that are not saved a notice says the
// results are for the saved inputs. The loss curve is one series with its table; the insurance card says in words how the supplier's cover stands against the one-in-twenty year.
import { Notice, SectionCard, StatusPill, Button } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { analysisCover } from '@/lib/statuses/vendorInsights';
import { LossCurve } from '../../../_lib/fair/shared';
import { money, oneIn, pct, type FairAnalysis } from '../../../_lib/fair/fairModel';

/** How often the cover is exceeded, as a sentence that reads at 0 as well: "is never exceeded in the simulated years." / "is exceeded in about 1 year in 14 (7% of simulated years)." */
const exceeded = (chance: number): string => (chance <= 0 ? 'is never exceeded in the simulated years.' : `is exceeded in ${oneIn(chance)} (${pct(chance)} of simulated years).`);

function Figure({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-ds-card border p-[12px] ${strong ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface'}`}>
      <dt className="break-words text-ds-label text-ds-fg-muted">{label}</dt>
      <dd className="m-0">
        <span className="block break-words text-[20px] font-[600] leading-[28px] tabular-nums text-ds-fg">{value}</span>
        {note && <span className="block break-words text-ds-label text-ds-fg-muted">{note}</span>}
      </dd>
    </div>
  );
}

export default function ResultTab({ a, stale, onFactors }: { a: FairAnalysis; stale: boolean; onFactors: () => void }) {
  const r = a.result;
  if (!r) {
    return (
      <SectionCard id="no-result" title="No result yet">
        <p className="text-ds-body text-ds-fg-muted">Save the inputs to run the analysis.</p>
        <div className="mt-[8px]"><Button onClick={onFactors}>Open the factors</Button></div>
      </SectionCard>
    );
  }
  const covers = r.cover?.covers_one_in_twenty;
  return (
    <div className="flex flex-col gap-[16px]" aria-live="polite">
      {stale && <Notice tone="warning" title="These results are for the saved inputs">Save and run to see the results of the changes you made on the Factors tab.</Notice>}
      <dl className="m-0 grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
        <Figure label="Chance of a loss this year" value={pct(r.annual.chance)} note={`${r.lef.mean.toFixed(2)} losses a year on average`} />
        <Figure label="Average year" value={money(r.annual.mean, a.currency)} note="Annualized loss exposure" />
        <Figure label="One year in ten" value={money(r.annual.p90, a.currency)} />
        <Figure label="One year in twenty" value={money(r.annual.p95, a.currency)} />
        <Figure label="One year in a hundred" value={money(r.annual.p99, a.currency)} />
        <Figure label="Least liability cap to accept" value={money(r.liability_cap, a.currency)} note="The one-in-twenty year, rounded up" strong />
      </dl>
      <SectionCard id="insurance" title="Insurance" actions={<StatusPill size="sm" {...statusPill(analysisCover, !r.cover ? 'none' : covers ? 'covers' : 'short')} />}>
        {!r.cover ? (
          <p className="text-ds-body text-ds-fg-body">No cover recorded for this supplier. To pay for the one-in-twenty year, their cyber insurance should cover at least <b className="font-[600]">{money(r.liability_cap, a.currency, false)}</b>.</p>
        ) : (
          <p className="text-ds-body text-ds-fg-body">
            Their cover of <b className="font-[600]">{money(r.cover.amount, a.currency, false)}</b> {exceeded(r.cover.chance_exceeded)}{' '}
            {covers ? 'It pays for the one-in-twenty year.' : <>The one-in-twenty year is {money(r.annual.p95, a.currency, false)}: <b className="font-[600]">{money(r.cover.gap_one_in_twenty, a.currency, false)} short</b>.</>}
          </p>
        )}
      </SectionCard>
      <SectionCard id="curve" title="How likely a year costs at least…" info={`Loss exceedance curve from ${r.iterations.toLocaleString('en-GB')} simulated years.`}>
        <div className="max-w-[760px]"><LossCurve points={r.lec} currency={a.currency} marks={[{ loss: r.annual.p90, label: '1 in 10' }, { loss: r.annual.p95, label: '1 in 20' }]} /></div>
      </SectionCard>
      <SectionCard id="single" title="What one loss costs">
        <div className="flex flex-col gap-[6px] text-ds-body text-ds-fg-body">
          <p className="text-ds-body text-ds-fg-body">A single loss costs {money(r.per_event.p10, a.currency)} to {money(r.per_event.p90, a.currency)} (80% of the time).</p>
          <p className="text-ds-body text-ds-fg-body">Of the average year, {money(r.split.primary, a.currency)} is our own cost and {money(r.split.secondary, a.currency)} comes from others reacting, which happens after {pct(r.split.secondary_share)} of losses.</p>
          <p className="text-ds-label text-ds-fg-muted">Every factor is a range drawn as a PERT distribution; losses arrive independently at the drawn rate. The same inputs always give the same numbers.</p>
        </div>
      </SectionCard>
    </div>
  );
}
