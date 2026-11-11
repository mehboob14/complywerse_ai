'use client';

// Where to act first: the sections furthest below their target across every scored module, lowest first, ten at most, as ranked bars (a bar per section in the colour of its grade, its
// module and grade word under the name, its score at the end). Each name opens the section's own page where it has one (a Compliance area), else the module (the other modules' sections
// have no address of their own). What is overdue is counted in "Needs attention"; this card is about quality, so the two never repeat each other. Every state is its own: waiting, an area
// that could not be read (said, with Retry), nothing below target (said in words), no scored area open to the person.
import { ChartCard } from '@/components/overview/charts';
import { STATUS } from '@/components/overview/charts/palette';
import { Button } from '@/components/ui/ds';
import { NamedBars, type NamedBar } from './Bars';
import { nameList, weakBars } from './perfCharts';
import { retryable, weakestAreas, type AreaRow } from './perfModel';

export function ActFirst({ rows, limit, onRetry }: { rows: readonly AreaRow[]; limit: number; onRetry: () => void }) {
  const scored = rows.filter((r) => r.area.kind === 'score' && r.state !== 'denied');
  const { rows: weak, total } = weakestAreas(rows, limit);
  const waiting = scored.some((r) => r.state === 'loading');
  const failed = scored.filter((r) => r.state === 'error');
  const answered = scored.filter((r) => r.state === 'ready').length;
  const retry = failed.some(retryable) ? onRetry : undefined;
  const bars: NamedBar[] = weakBars(weak).map((b) => ({ key: b.key, label: b.label, value: b.value, note: b.note, href: b.href, color: STATUS[b.status], figure: <span className="text-right text-ds-body tabular-nums text-ds-fg">{b.valueText}</span> }));
  const state = weak.length > 0 ? 'ready' : waiting ? 'loading' : failed.length > 0 ? 'error' : 'empty';
  return (
    <ChartCard
      id="work"
      title="Where to act first"
      info="The sections furthest below their target, across the modules that have a score, lowest first. Each opens its module. Overdue items are counted in Needs attention; this card is about quality."
      meta={total > weak.length ? `Showing ${weak.length} of ${total}` : total > 0 ? `${total} below target` : undefined}
      state={state}
      loadingHeight={240}
      error={{ title: "Couldn't load the scored areas", message: `${nameList(failed.map((r) => r.area.label))} could not be read.`, onRetry: retry }}
      emptyText={answered > 0 ? 'Every scored area is at or above its target.' : 'None of the scored areas are open to your account.'}
    >
      <NamedBars label="Sections furthest below their target" rows={bars} max={100} nameWidth={200} figureWidth={44} />
      {failed.length > 0 && (
        <div className="mt-[12px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          {`This list leaves out ${nameList(failed.map((r) => r.area.label))}: ${failed.length === 1 ? 'it' : 'they'} could not be read.`}
          {retry && <Button variant="link" size="sm" onClick={retry}>Retry</Button>}
        </div>
      )}
    </ChartCard>
  );
}
