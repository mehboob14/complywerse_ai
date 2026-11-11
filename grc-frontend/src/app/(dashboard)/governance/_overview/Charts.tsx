'use client';

// The graphical part of the Governance Overview: one ChartCard for each thing a governance lead wants to see at a glance. Every card rests on the request(s)
// the page already holds (no request of its own) and has its five states apart from the others: loading, failed (with Retry, in the server's words), "No access"
// (a refusal is not a failure), nothing to show yet (a plain line that says what fills it) and the chart; a failed or refused request is never drawn as an empty
// chart or a 0. Every chart is a picture with its numbers as text (the list it is, or a table for a screen reader), and what opens records is a real link.
// What each card draws is visualsModel.ts; the cards of the groups (review health, where attention sits) are ./GroupCharts.tsx.
import Link from 'next/link';
import { BarList, ChartCard, DonutChart, SegmentBar, TrendChart, SERIES, type ChartCardProps } from '@/components/overview/charts';
import { BRAND } from '@/components/overview/charts/palette';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { SectionChart } from './SectionChart';
import { FOCUS, link, type Feed } from './parts';
import type { DocumentsSummary, Scorecard } from './overviewModel';
import {
  archivedCount, cardState, exceptionParts, flowBars, flowIsEmpty, lapseIsEmpty, lapseRows, monthSeries, priorityRows, sectionChart, statusRows, trendIsEmpty, trendTotals, typeSlices,
  type ExceptionsAnswer, type ExpiringAnswer, type TrendsAnswer,
} from './visualsModel';

type AnyFeed = Feed<unknown>;

/** The state of a card that rests on these requests, with what its failure says and what Retry asks again (only the requests that failed, and only if asking again can help). */
export function cardProps(feeds: readonly AnyFeed[]): Pick<ChartCardProps, 'state' | 'error' | 'deniedText'> {
  const state = cardState(...feeds);
  if (state !== 'error') return { state, deniedText: 'Your account cannot read this part of the programme.' };
  const failed = feeds.filter((f) => f.load === 'error');
  return {
    state,
    error: { message: errorMessage(failed[0]?.error), onRetry: failed.every((f) => canRetry(f.error)) ? () => failed.forEach((f) => f.retry()) : undefined },
  };
}

const OPEN_LINK = `rounded-ds-control text-ds-body text-ds-primary-text hover:underline ${FOCUS}`;

// ── the sections against the target ──────────────────────────────────────────────────────────────────────────────────────
export function SectionScoresCard({ scorecard }: { scorecard: Feed<Scorecard> }) {
  const chart = sectionChart(scorecard.data);
  const base = cardProps([scorecard]);
  const state = base.state === 'ready' && chart.bars.length === 0 ? 'empty' : base.state;
  return (
    <ChartCard
      id="section-scores"
      title="Section scores"
      meta={state === 'ready' ? `Target ${chart.target}` : undefined}
      info="Each section's score against the target (the dashed line), weakest first. A bar is coloured by its band: strong from 80, fair from 60. A section with nothing to score yet is not a bar. The score is the server's weighted mean of the section scores; how each is made is in the posture card."
      actions={state === 'ready' ? <Link href="#breakdown" className={OPEN_LINK}>How it is made</Link> : undefined}
      {...base}
      state={state}
      emptyText="No section scores yet. They appear once there are documents, reviews or approvals to measure."
      loadingHeight={300}
    >
      <SectionChart chart={chart} />
    </ChartCard>
  );
}

// ── the library: by status, by type ──────────────────────────────────────────────────────────────────────────────────────
export function StatusCard({ summary }: { summary: Feed<DocumentsSummary> }) {
  const rows = statusRows(summary.data);
  const total = summary.data?.total_documents ?? 0;
  const base = cardProps([summary]);
  const state = base.state === 'ready' && total === 0 ? 'empty' : base.state;
  return (
    <ChartCard
      id="by-status"
      title="Documents by status"
      meta={state === 'ready' ? `${formatCount(total)} in all` : undefined}
      info="Every document, archived ones too, at each step of the approval flow from draft to published, then the states outside it. Each bar opens the library on that status."
      {...base}
      state={state}
      emptyText="No documents yet. They appear here once one is created."
      loadingHeight={220}
    >
      <BarList label="Documents by status" rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.value, color: r.color, href: link(r.href as string) }))} max={Math.max(1, ...rows.map((r) => r.value))} nameWidth={120} />
    </ChartCard>
  );
}

export function TypeCard({ summary }: { summary: Feed<DocumentsSummary> }) {
  const slices = typeSlices(summary.data);
  const total = summary.data?.total_documents ?? 0;
  const archived = archivedCount(summary.data);
  const base = cardProps([summary]);
  const state = base.state === 'ready' && slices.length === 0 ? 'empty' : base.state;
  return (
    <ChartCard
      id="by-type"
      title="Documents by type"
      meta={state === 'ready' && archived > 0 ? `${formatCount(archived)} archived included` : undefined}
      info="Every document, archived ones too, by what kind of document it is. The five biggest kinds are shown, the rest are Other. A kind opens the library on it."
      {...base}
      state={state}
      emptyText="No documents yet. They appear here once one is created."
      loadingHeight={160}
    >
      <div className="flex h-full min-h-[160px] items-center justify-center">
        <DonutChart label="Documents by type" slices={slices.map((s) => ({ ...s, href: s.href ? link(s.href) : undefined }))} centre={{ value: formatCount(total), caption: total === 1 ? 'document' : 'documents' }} noun="documents" />
      </div>
    </ChartCard>
  );
}

// ── throughput ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function ThroughputCard({ trends, now }: { trends: Feed<TrendsAnswer>; now: Date }) {
  const rows = monthSeries(trends.data, now);
  const totals = trendTotals(rows);
  const base = cardProps([trends]);
  const state = base.state === 'ready' && trendIsEmpty(rows) ? 'empty' : base.state;
  return (
    <ChartCard
      id="throughput"
      title="Created and published"
      meta={state === 'ready' ? `${formatCount(totals.created)} created · ${formatCount(totals.published)} published${totals.liveRate === null ? '' : ` · ${totals.liveRate}% live`}` : undefined}
      info="Documents created and documents published in each of the last six calendar months; the current month is still running. Live: the documents published in these months as a share of the documents created in them."
      {...base}
      state={state}
      emptyText="No documents created or published in the last six months. They appear here as documents are created and published."
      loadingHeight={240}
    >
      <TrendChart
        label="Documents created and published by month"
        firstColumn="Month"
        rows={rows.map((r) => ({ label: r.label, created: r.created, published: r.published }))}
        series={[{ key: 'created', label: 'Created', color: SERIES[0] }, { key: 'published', label: 'Published', color: SERIES[1] }]}
        variant="area"
        height={240}
      />
    </ChartCard>
  );
}

// ── what lapses when ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function LapseCard({ scorecard, expiring, summary }: { scorecard: Feed<Scorecard>; expiring: Feed<ExpiringAnswer>; summary: Feed<DocumentsSummary> }) {
  const rows = lapseRows(scorecard.data, expiring.data, summary.data);
  const base = cardProps([scorecard, expiring]);
  const state = base.state === 'ready' && lapseIsEmpty(rows) ? 'empty' : base.state;
  return (
    <ChartCard
      id="lapse"
      title="What lapses when"
      meta={state === 'ready' ? 'Next 90 days' : undefined}
      info="Reviews falling due (approved and published documents with a review date) and documents reaching their expiry date, in three windows from today: within 30 days, 31 to 60 days (the 60 days column) and 61 to 90 days (the 90 days column). Past due is what has lapsed already: overdue reviews and expired documents. Documents expiring counts every document with an expiry date, whatever its status."
      {...base}
      state={state}
      emptyText="Nothing is past due or falls due in the next 90 days."
      loadingHeight={220}
    >
      <TrendChart
        label="Reviews due and documents expiring by period"
        firstColumn="Period"
        rows={rows.map((r) => ({ label: r.label, reviews: r.reviews, expiring: r.expiring }))}
        series={[{ key: 'reviews', label: 'Reviews', color: SERIES[0] }, { key: 'expiring', label: 'Documents expiring', color: SERIES[1] }]}
        variant="bars"
        height={220}
      />
    </ChartCard>
  );
}

// ── exceptions ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function ExceptionsCard({ exceptions }: { exceptions: Feed<ExceptionsAnswer> }) {
  const parts = exceptionParts(exceptions.data?.by_status);
  const priorities = priorityRows(exceptions.data?.by_priority, BRAND);
  const total = exceptions.data?.total ?? 0;
  const base = cardProps([exceptions]);
  const state = base.state === 'ready' && total === 0 ? 'empty' : base.state;
  const expiring = exceptions.data?.expiring_soon ?? 0;
  return (
    <ChartCard
      id="exceptions"
      title="Policy exceptions"
      meta={state === 'ready' ? `${formatCount(total)} in all` : undefined}
      info="Every exception by where it stands: along the route (draft, waiting for a decision, approved) and how it ended. Expiring soon: approved and lapsing within 30 days. Priority is what the requester gave it."
      actions={state === 'ready' ? <Link href={link('/governance/exceptions')} className={OPEN_LINK}>Open</Link> : undefined}
      {...base}
      state={state}
      emptyText="No exceptions yet. They appear here once one is raised."
      loadingHeight={200}
    >
      <SegmentBar label="Exceptions by status" parts={parts} height={16} />
      {expiring > 0 && <p className="mt-[8px] text-ds-label text-ds-fg-muted">{`${formatCount(expiring)} expiring soon`}</p>}
      {priorities.length > 0 && (
        <div className="mt-[16px] border-t border-ds-border pt-[12px]">
          <h3 className="mb-[8px] !text-ds-label !text-ds-fg-muted">By priority</h3>
          <BarList label="Exceptions by priority" rows={priorities.map((r) => ({ key: r.key, label: r.label, value: r.value }))} nameWidth={90} />
        </div>
      )}
    </ChartCard>
  );
}

// ── requests and actions ─────────────────────────────────────────────────────────────────────────────────────────────────
export function FlowCard({ scorecard }: { scorecard: Feed<Scorecard> }) {
  const bars = flowBars(scorecard.data);
  const base = cardProps([scorecard]);
  const state = base.state === 'ready' && (bars.length === 0 || flowIsEmpty(bars)) ? 'empty' : base.state;
  return (
    <ChartCard
      id="requests"
      title="Requests and actions"
      info="What people have been asked to do, each as one bar: done, waiting and overdue. Done: decided in the last 90 days (reviews and approvals), acknowledged in the last 12 months, or completed (committee actions). Overdue: past the due date. Each name opens its page."
      {...base}
      state={state}
      emptyText="Nothing has been asked of anyone yet. Reviews, approvals, acknowledgements and committee actions appear here once they are."
      loadingHeight={220}
    >
      <div className="flex flex-col gap-[16px]">
        {bars.map((b) => (
          <div key={b.key}>
            <div className="mb-[6px] flex items-baseline justify-between gap-[8px]">
              <Link href={link(b.href)} className={`min-w-0 truncate text-ds-body font-[500] text-ds-fg hover:underline ${FOCUS}`}>{b.label}</Link>
              <span className="shrink-0 text-ds-label tabular-nums text-ds-fg-muted">{formatCount(b.total)}</span>
            </div>
            <SegmentBar label={b.label} parts={b.parts} height={12} />
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
