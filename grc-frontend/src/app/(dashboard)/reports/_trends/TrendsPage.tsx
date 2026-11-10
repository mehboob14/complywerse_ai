'use client';

/**
 * Trends: how the key numbers of every module you can see have moved. A BOARD of cards by module (a figure, how it moved, a sparkline, its status against its target), or a TABLE of the same figures; the status chips across the top
 * count the figures by where they stand and filter the board; "Needs attention first" lists the off-target ones ahead of the rest. A card or a row opens the figure's Sheet (TrendSheet). The board keeps its state in the address
 * (?view=table&order=attention&status=critical,warn&range=90&metric=open_risks), so a link opens the same view and one figure.
 *
 * Nothing captures the numbers by itself (no scheduler runs), so the page says when the newest values are from, warns when they are old, and offers "Capture today's values": one point per day is added to every line. A person who may
 * see no figure is told so (zero cards is not "no history"); a failed read says so with Retry.
 */
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { Activity, Camera, LockKeyhole } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Notice, SegmentedControl, Skeleton, StatusPill, useAddressState, useReportedMutation } from '@/components/ui/ds';
import { useQuery } from '@tanstack/react-query';
import { statusPill } from '@/lib/status';
import { trendStatus } from '@/lib/statuses/trends';
import { trendsApi } from '../_reports/trends';
import { TrendCardTile, TrendTable } from './TrendCards';
import { TrendSheet } from './TrendSheet';
import { STATUS_KEYS, TRENDS_SCHEMA, rangeOf, type View } from './trendsAddress';
import { RANGES, filterCards, formatDay, groupByModule, lastCaptured, orderCards, sortCards, staleDays, statusCounts, totalPoints, type Order, type OverviewResp, type Rag } from './trendsModel';

export const TITLE = 'Trends';
const INFO = "How the key numbers of each module have moved. Every time you capture today's values, each line gains one point, and a line needs values from two different days.";
const GRID = 'grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
const TODAY = () => new Date().toISOString().slice(0, 10);

function StatusToggle({ rag, count, on, onToggle }: { rag: Rag; count: number; on: boolean; onToggle: () => void }) {
  const idle = count === 0 && !on;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={idle || undefined}
      onClick={() => { if (!idle) onToggle(); }}
      className={clsx(
        'inline-flex min-h-[44px] items-center gap-[8px] rounded-ds-control border px-[10px] text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring sm:min-h-ds-control',
        on ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border-strong bg-ds-surface hover:bg-ds-surface-hover',
        idle && 'cursor-not-allowed opacity-50',
      )}
    >
      <StatusPill size="sm" {...statusPill(trendStatus, rag)} />
      <span className="font-[600] tabular-nums text-ds-fg">{count}</span>
    </button>
  );
}

export function TrendsPage() {
  const [state, set] = useAddressState(TRENDS_SCHEMA);
  const days = rangeOf(state.range);
  const overview = useQuery<OverviewResp>({ queryKey: ['trends', 'overview', days], queryFn: () => trendsApi.overview(days) });
  const cards = useMemo(() => overview.data?.cards ?? [], [overview.data]);
  const counts = useMemo(() => statusCounts(cards), [cards]);
  const last = useMemo(() => lastCaptured(cards), [cards]);
  const old = staleDays(last, TODAY());
  const noHistory = cards.length > 0 && totalPoints(cards) === 0;

  const capture = useReportedMutation({
    mutationFn: () => trendsApi.snapshot(),
    success: "Today's values captured",
    failure: "Couldn't capture today's values",
    invalidate: [['trends']],
  });

  const shown = useMemo(() => filterCards(cards, state.status), [cards, state.status]);
  const open = state.metric ? cards.find((c) => c.key === state.metric) ?? null : null;
  const missingLink = !!state.metric && overview.isSuccess && !open;
  const filtered = state.status.length > 0;
  const toggle = (rag: Rag) => set({ status: state.status.includes(rag) ? state.status.filter((s) => s !== rag) : STATUS_KEYS.filter((k) => k === rag || state.status.includes(k)) });

  const captureButton = (primary: boolean) => (
    <Button variant={primary ? 'primary' : 'secondary'} leftIcon={<Camera aria-hidden />} loading={capture.isPending} onClick={() => capture.mutate()}>Capture today&apos;s values</Button>
  );
  const header = (
    <PageHeader
      variant="page"
      title={TITLE}
      info={INFO}
      meta={overview.isSuccess && cards.length > 0 ? `${cards.length} ${cards.length === 1 ? 'figure' : 'figures'} · ${last ? `last captured ${formatDay(last)}` : 'nothing captured yet'}` : undefined}
      actions={overview.isSuccess && cards.length > 0 && !noHistory && old == null ? captureButton(false) : undefined}       // when the values are old the notice below carries the button
    />
  );

  // ── loading, failed, nothing to show ──
  if (overview.isPending) {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        {header}
        <div role="status" aria-busy="true" className={GRID}>
          <span className="sr-only">Loading the trends</span>
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[148px] w-full" />)}
        </div>
      </div>
    );
  }
  if (overview.isError) {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        {header}
        <ErrorState title="Couldn't load the trends" message="The server did not answer. Check your connection and try again." onRetry={() => { void overview.refetch(); }} />
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        {header}
        <EmptyState kind="firstUse" icon={LockKeyhole} title="No figures are open to your role" description="Each figure on this page belongs to a module, and your role does not include any of them. Ask your administrator if you need to follow one." />
      </div>
    );
  }
  if (noHistory) {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        {header}
        <EmptyState
          kind="firstUse" icon={Activity} title="No values captured yet"
          description="Each line is built from the numbers captured on different days. Capture today's values now, and again on another day, and the lines fill in."
          action={captureButton(true)}
        />
      </div>
    );
  }

  const board = state.view === 'table'
    ? <TrendTable cards={sortCards(shown, state.sort)} sort={state.sort} onSortChange={(sort) => set({ sort })} onOpen={(c) => set({ metric: c.key }, { push: true })} selectedKey={open?.key ?? null} />
    : state.order === 'attention'
      ? <div className={GRID}>{orderCards(shown, 'attention').map((c) => <TrendCardTile key={c.key} card={c} showModule onOpen={() => set({ metric: c.key }, { push: true })} />)}</div>
      : (
        <div className="flex flex-col gap-[20px]">
          {groupByModule(shown).map((g) => (
            <section key={g.module} aria-label={g.label} className="flex flex-col gap-[8px]">
              <h2 className="m-0 flex items-baseline gap-[8px] !text-ds-section !font-[600] !text-ds-fg">{g.label}<span className="text-ds-body font-normal text-ds-fg-muted">{g.cards.length}</span></h2>
              <div className={GRID}>{g.cards.map((c) => <TrendCardTile key={c.key} card={c} showModule={false} onOpen={() => set({ metric: c.key }, { push: true })} />)}</div>
            </section>
          ))}
        </div>
      );

  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      {header}

      {old != null && <Notice tone="warning" title={`The newest values are ${old} days old`} action={captureButton(false)}>Nothing captures the numbers by itself. Capture today&apos;s values to bring every line up to date.</Notice>}
      {missingLink && <Notice tone="info" title="That figure is not available" action={<Button onClick={() => set({ metric: '' })}>Dismiss</Button>}>It may not exist, or your role does not include its module.</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px]">
        <div role="group" aria-label="Show figures that are" className="flex flex-wrap items-center gap-[8px]">
          {RAG_TOGGLES.map((rag) => <StatusToggle key={rag} rag={rag} count={counts[rag]} on={state.status.includes(rag)} onToggle={() => toggle(rag)} />)}
          {filtered && <Button variant="ghost" onClick={() => set({ status: [] })}>Show all</Button>}
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <SegmentedControl label="Range" name="trends-range" options={RANGES.map((r) => ({ value: String(r.days), label: r.label }))} value={String(days)} onChange={(v) => set({ range: Number(v) })} />
          <SegmentedControl<View> label="View" name="trends-view" options={[{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }]} value={state.view} onChange={(view) => set({ view })} />
          {state.view === 'board' && (
            <SegmentedControl<Order> label="Order" name="trends-order" options={[{ value: 'module', label: 'By module' }, { value: 'attention', label: 'Needs attention first' }]} value={state.order} onChange={(order) => set({ order })} />
          )}
        </div>
      </div>

      {shown.length === 0
        ? <EmptyState kind="noMatches" title="No figures stand there" description="None of your figures has that status right now." onClearFilters={() => set({ status: [] })} />
        : board}

      {open && <TrendSheet key={open.key} boardCard={open} boardDays={days} onClose={() => set({ metric: '' })} />}
    </div>
  );
}

const RAG_TOGGLES: readonly Rag[] = ['critical', 'warn', 'ok', 'none'];
