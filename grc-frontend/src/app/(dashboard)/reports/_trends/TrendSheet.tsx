'use client';

// One figure, in a Sheet: the value and how it moved, the line over the range chosen with its target and warning level, the values as a table anyone can read, the split by its dimension with a table that lists every slice, how it is
// worked out, and the target. The Sheet is the kit's (Escape, focus kept inside and returned to the card, a bottom sheet on a phone). It paints at once from the card the board already holds; it asks the server for the series only when the range
// differs from the board's, and for the breakdown only when the figure has a dimension. A request that fails says so with Retry.
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { ErrorState, Sheet, SegmentedControl, Skeleton, StatusPill, TBody, THead, Table, Td, Th, Tr, RowHeaderCell } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { trendStatus } from '@/lib/statuses/trends';
import { trendsApi } from '../_reports/trends';
import { BreakdownChart, TrendChart } from './TrendCharts';
import { Delta } from './TrendCards';
import { TargetPanel } from './TargetPanel';
import { RANGES, formatDay, formatValue, hasSeries, rangeLabel, sinceWords, sliceRows, summarySentence, unitTag, valueRows, type TrendCard } from './trendsModel';

const HEAD = 'm-0 !text-ds-body !font-[600] !text-ds-fg';
const SUMMARY = 'flex min-h-[44px] cursor-pointer list-none items-center gap-[6px] rounded-ds-control px-[4px] text-ds-body font-[600] text-ds-primary-text hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring sm:min-h-ds-control [&::-webkit-details-marker]:hidden';

/** The table that stands beside the line chart: every captured value, newest first, in a box that scrolls. Closed until asked for. */
function ValuesTable({ card }: { card: TrendCard }) {
  const rows = valueRows(card.points, card.unit);
  if (rows.length === 0) return null;
  return (
    <details className="group">
      <summary className={SUMMARY}>
        <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 transition-transform group-open:rotate-90" strokeWidth={1.75} />
        Show the values ({rows.length})
      </summary>
      <div className="mt-[4px] max-h-[240px] overflow-auto rounded-ds-card border border-ds-border">
        <Table caption={`${card.label}: every captured value, newest first`}>
          <THead><Tr><Th>Day</Th><Th align="right">Value</Th></Tr></THead>
          <TBody>{rows.map((r) => <Tr key={r.date}><RowHeaderCell>{r.day}</RowHeaderCell><Td align="right"><span className="tabular-nums">{r.value}</span></Td></Tr>)}</TBody>
        </Table>
      </div>
    </details>
  );
}

export function TrendSheet({ boardCard, boardDays, onClose }: { boardCard: TrendCard; boardDays: number; onClose: () => void }) {
  const [range, setRange] = useState(boardDays);
  const [dirty, setDirty] = useState(false);
  const setEditorDirty = useCallback((d: boolean) => setDirty(d), []);
  const key = boardCard.key;

  // the board's own card is the answer for the board's range: the Sheet opens with its picture and asks for nothing until another range is chosen
  const sameRange = range === boardDays;
  const detail = useQuery({ queryKey: ['trends', 'series', key, range], queryFn: () => trendsApi.series(key, range), enabled: !sameRange });
  const card = sameRange ? boardCard : detail.data ?? boardCard;
  const breakdown = useQuery({
    queryKey: ['trends', 'breakdown', key, range],
    queryFn: () => trendsApi.breakdown(key, range),
    enabled: !!card.dimension,
  });
  const label = rangeLabel(range);
  const since = sinceWords(card.points);
  const sentence = summarySentence(card);

  return (
    <Sheet open onClose={onClose} title={card.label} subtitle={card.module_label} width="lg" dirty={dirty} discardLabel="Discard the changes" keepLabel="Keep editing">
      <div className="flex min-w-0 flex-col gap-[16px]">
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
          <span className="text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{formatValue(card.current, card.unit)}</span>
          {unitTag(card.unit) && card.unit !== 'pct' && card.unit !== 'days' && <span className="text-ds-body text-ds-fg-muted">{unitTag(card.unit)}</span>}
          <Delta card={card} />
          {since && <span className="text-ds-label text-ds-fg-muted">{since}</span>}
          <StatusPill {...statusPill(trendStatus, card.status)} />
          <span className="text-ds-label text-ds-fg-muted">{card.as_of ? `As of ${formatDay(card.as_of)}` : 'No values yet'}</span>
        </div>

        <SegmentedControl label="Range of the chart" name="trend-sheet-range" options={RANGES.map((r) => ({ value: String(r.days), label: r.label }))} value={String(range)} onChange={(v) => setRange(Number(v))} />

        <div aria-busy={!sameRange && detail.isPending}>
          {!sameRange && detail.isError ? (
            <ErrorState compact title="Couldn't load this range" message="The server did not answer. Try again, or choose another range." onRetry={() => { void detail.refetch(); }} />
          ) : !sameRange && detail.isPending ? (
            <Skeleton className="h-[230px] w-full" />
          ) : hasSeries(card.points) ? (
            <div className="flex flex-col gap-[8px]">
              <TrendChart card={card} rangeLabel={label} />
              {sentence && <p className="m-0 text-ds-body text-ds-fg-body">{sentence}</p>}
              <ValuesTable card={card} />
            </div>
          ) : (
            <div className="rounded-ds-card border border-dashed border-ds-border-strong p-[16px] text-center">
              <p className="m-0 text-ds-body font-[600] text-ds-fg">Not enough history yet</p>
              <p className="m-0 mt-[4px] text-ds-body text-ds-fg-muted">{`A line needs values from two different days. The value now is ${formatValue(card.current, card.unit)}. Capture today's values again on another day to draw the line.`}</p>
            </div>
          )}
        </div>

        {card.dimension && (
          <section aria-label={`By ${card.dimension}`} className="flex flex-col gap-[8px]">
            <h3 className={`${HEAD} capitalize`}>By {card.dimension}</h3>
            {breakdown.isPending ? (
              <Skeleton className="h-[220px] w-full" />
            ) : breakdown.isError || !breakdown.data ? (
              <ErrorState compact title="Couldn't load the breakdown" message="The server did not answer." onRetry={() => { void breakdown.refetch(); }} />
            ) : (
              <>
                <BreakdownChart data={breakdown.data} unit={card.unit} title={`${card.label} by ${card.dimension}`} rangeLabel={label} />
                <div className="max-h-[260px] overflow-auto rounded-ds-card border border-ds-border">
                  <Table caption={`${card.label} by ${card.dimension}: the latest value of every one`}>
                    <THead><Tr><Th><span className="capitalize">{card.dimension}</span></Th><Th align="right">Latest</Th><Th align="right">Change over {label}</Th></Tr></THead>
                    <TBody>
                      {sliceRows(breakdown.data.series).map((r) => (
                        <Tr key={r.key}>
                          <RowHeaderCell><span className="capitalize">{r.key}</span></RowHeaderCell>
                          <Td align="right"><span className="tabular-nums">{formatValue(r.latest, card.unit)}</span></Td>
                          <Td align="right"><span className="tabular-nums">{r.change == null ? '—' : `${r.change > 0 ? '+' : r.change < 0 ? '−' : ''}${formatValue(Math.abs(r.change), card.unit)}`}</span></Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </>
            )}
          </section>
        )}

        {card.definition && (
          <section aria-label="How it is worked out" className="flex flex-col gap-[4px]">
            <h3 className={HEAD}>How it is worked out</h3>
            <p className="m-0 text-ds-body text-ds-fg-body">{card.definition}</p>
          </section>
        )}

        <TargetPanel card={card} onDirty={setEditorDirty} />
      </div>
    </Sheet>
  );
}
