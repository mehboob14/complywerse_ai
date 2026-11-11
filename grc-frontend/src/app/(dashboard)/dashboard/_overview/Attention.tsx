'use client';

// Needs attention: every counter of every area that answered, as ranked bars (the biggest first), each in the colour of its tone and named by the counter's own words ("Overdue
// reviews", "Lapsed evidence": the word beside the colour). A bar's name opens the records it counts, or the module that lists them. The counters are not added together: they are in
// different units and the same item can be counted by two modules. The ones that answered 0 stay one press away under the bars (nothing is hidden by being 0); a counter the answer
// carried no number for is said as a count, never drawn as 0; an area that failed or is still loading is named with its own Retry, and a refused area is simply not here.
import { RotateCw } from 'lucide-react';
import { ChartCard } from '@/components/overview/charts';
import { STATUS } from '@/components/overview/charts/palette';
import { Button, CountRow } from '@/components/ui/ds';
import { NamedBars, type NamedBar } from './Bars';
import { formatCount } from '@/lib/format';
import { attentionView, nameList } from './perfCharts';
import { retryable, type AreaRow } from './perfModel';

export function Attention({ rows, limit, onRetry }: { rows: readonly AreaRow[]; limit: number; onRetry: () => void }) {
  const view = attentionView(rows);
  const shown = view.bars.slice(0, limit);
  const hidden = view.bars.length - shown.length;
  const top = Math.max(1, ...shown.map((b) => b.value));
  const barRows: NamedBar[] = shown.map((b) => ({ key: b.key, label: b.label, value: b.value, note: b.area, href: b.href, color: STATUS[b.status], figure: <span className="text-right text-ds-body tabular-nums text-ds-fg">{formatCount(b.value)}</span> }));
  const retryFailed = view.failed.some(retryable) ? onRetry : undefined;
  const failedNames = nameList(view.failed.map((r) => r.area.label));
  // what the bars leave out, in words: the areas that failed and the ones still loading
  const leftOut = [
    view.failed.length > 0 ? `Leaves out ${failedNames}: ${view.failed.length === 1 ? 'it' : 'they'} could not be read.` : '',
    view.waiting > 0 ? `${view.waiting} ${view.waiting === 1 ? 'area is' : 'areas are'} still loading.` : '',
  ].filter(Boolean);
  return (
    <ChartCard
      id="attention"
      title="Needs attention"
      info="Overdue, lapsed, breached and critical items, one bar for each count a module makes, the biggest first. Each opens the records it counts, or the module that lists them. The counts are in different units and are not added together: the same item can be counted by two modules."
      meta={view.state === 'ready' ? `${view.withItems} of ${view.reporting} ${view.reporting === 1 ? 'area' : 'areas'}` : undefined}
      state={view.state}
      loadingHeight={240}
      error={{ title: "Couldn't load what needs attention", message: `${failedNames} could not be read.`, onRetry: retryFailed }}
      emptyText="None of the areas you can open reports counts of items that need attention."
    >
      {barRows.length > 0 ? (
        <NamedBars label="Items that need attention, by count" rows={barRows} max={top} nameWidth={200} figureWidth={44} />
      ) : (
        <p className="py-[8px] text-ds-body text-ds-fg-muted">Nothing is overdue, lapsed, breached or critical in the areas that answered.</p>
      )}
      {hidden > 0 && <p className="mt-[8px] text-ds-label text-ds-fg-muted">{`${formatCount(hidden)} more ${hidden === 1 ? 'count has' : 'counts have'} something in them. Each area's counts are in By area below.`}</p>}
      {view.quiet.length > 0 && (
        <div className="mt-[16px] border-t border-ds-border pt-[12px]">
          <p id="attention-quiet" className="mb-[8px] text-ds-label font-[600] text-ds-fg-muted">Nothing counted</p>
          <ul aria-labelledby="attention-quiet" className="m-0 list-none p-0">
            {view.quiet.map((c) => (
              <CountRow key={c.key} layout="chip" label={c.label} href={c.href} tone={c.tone} count={0} className="mb-[6px] mr-[8px] inline-flex align-top" />
            ))}
          </ul>
        </div>
      )}
      {view.unreported > 0 && <p className="mt-[8px] text-ds-label text-ds-fg-muted">{`${formatCount(view.unreported)} ${view.unreported === 1 ? 'count was' : 'counts were'} not in the answer.`}</p>}
      {leftOut.length > 0 && (
        <div className="mt-[12px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          {leftOut.join(' ')}
          {retryFailed && <Button variant="link" size="sm" leftIcon={<RotateCw aria-hidden />} onClick={retryFailed}>Retry</Button>}
        </div>
      )}
    </ChartCard>
  );
}
