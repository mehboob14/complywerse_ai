'use client';

// The cards of the Summary, one ChartCard for each thing a governance lead wants to see at a glance, in graphics: section scores (small tiles in their status colour),
// documents by status, by type, the review dates, the people asked, what was created and published, what expires and the exceptions. Every card rests on the request(s)
// the page already holds (no request of its own) and has its five states apart from the others: loading, failed (with Retry, in the server's words), "No access" (a
// refusal is not a failure), nothing to show yet (a plain line that says what fills it) and the chart; a failed or refused request is never drawn as an empty chart or
// a 0. Every chart is a picture with its numbers as text, the card's title opens the module's list, and every bar, slice and tile is a link to the records it counts.
// The document cards are scoped to the department the person picked (docs/_summary.ts); the others are the whole organisation and say so when a department is picked.
import { AreaTiles, BarList, ChartCard, DonutChart, SegmentBar, StackedBars, TrendChart, SERIES, type ChartCardProps } from '@/components/overview/charts';
import { STATUS } from '@/components/overview/charts/palette';
import { Button } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { capStack, departmentStack } from './docs/_chart';
import { figureHref, hasDepartmentTable, isEmpty, LIBRARY, type Overview } from './docs/_model';
import { noRequests, requestBars, reviewSlices, statusBarRows, typeSlices } from './docs/_summary';
import { viewHref } from './docs/_views';
import { link, type Feed } from './parts';
import type { Scorecard } from './overviewModel';
import {
  SECTION_WORDS, cardState, exceptionParts, expiringIsEmpty, expiringRows, monthSeries, sectionTarget, sectionTiles, trendIsEmpty, wholeOrganisation,
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

/** The state of a card that draws the documents of the scope: empty when the scope has none, whatever else is true. */
function docState(doc: Feed<Overview>): { card: ReturnType<typeof cardProps>; data?: Overview; library: string } {
  const base = cardProps([doc]);
  const data = doc.data;
  const state = base.state === 'ready' && data && isEmpty(data) ? 'empty' : base.state;
  return { card: { ...base, state }, data, library: (data && figureHref(data, 'totals.documents')) || LIBRARY };
}

const NO_DOCS = 'No documents in this scope yet. They appear here once one is created.';

// ── the sections against the target ──────────────────────────────────────────────────────────────────────────────────────
export function SectionScoresCard({ scorecard, scoped, onHow }: { scorecard: Feed<Scorecard>; scoped: boolean; onHow: () => void }) {
  const items = sectionTiles(scorecard.data);
  const base = cardProps([scorecard]);
  const state = base.state === 'ready' && items.length === 0 ? 'empty' : base.state;
  const said = wholeOrganisation(scoped, "Each section's score against the target, coloured by its band: strong from 80, fair from 60. A section with nothing to score yet is not scored. The score is the server's weighted mean of the section scores. A tile opens the page that lists what the section counts.");
  return (
    <ChartCard
      id="section-scores"
      title="Section scores"
      meta={state === 'ready' ? [`Target ${sectionTarget(scorecard.data)}`, said.meta].filter(Boolean).join(' · ') : undefined}
      info={said.info}
      actions={state === 'ready' ? <Button size="sm" aria-haspopup="dialog" onClick={onHow}>How scored</Button> : undefined}
      {...base}
      state={state}
      emptyText="No section scores yet. They appear once there are documents, reviews or approvals to measure."
      loadingHeight={220}
    >
      <AreaTiles label="Section scores" items={items.map((i) => ({ ...i, href: i.href ? link(i.href) : undefined }))} words={SECTION_WORDS} />
    </ChartCard>
  );
}

// ── the documents: by status, by type, the review dates ──────────────────────────────────────────────────────────────────
export function StatusCard({ doc }: { doc: Feed<Overview> }) {
  const s = docState(doc);
  const rows = s.data ? statusBarRows(s.data) : [];
  return (
    <ChartCard
      id="by-status"
      title="Documents by status"
      info="Documents that are not archived, at each step of the approval flow from draft to published, and the states outside it that some document is in. A bar opens the library on that status."
      href={link(s.library)}
      hrefLabel="Open the document library"
      {...s.card}
      emptyText={NO_DOCS}
      loadingHeight={220}
    >
      <BarList label="Documents by status" rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.value, color: r.color, href: r.href ? link(r.href) : undefined }))} nameWidth={120} />
    </ChartCard>
  );
}

export function TypeCard({ doc }: { doc: Feed<Overview> }) {
  const s = docState(doc);
  const slices = s.data ? typeSlices(s.data) : [];
  return (
    <ChartCard
      id="by-type"
      title="Documents by type"
      info="Documents that are not archived, by what kind of document each is. The five biggest kinds are shown, the rest are Other. A kind opens the library on it."
      href={link(s.library)}
      hrefLabel="Open the document library"
      {...s.card}
      emptyText={NO_DOCS}
      loadingHeight={180}
    >
      <DonutChart label="Documents by type" slices={slices.map((x) => ({ ...x, href: x.href ? link(x.href) : undefined }))} noun="documents" />
    </ChartCard>
  );
}

export function ReviewsCard({ doc }: { doc: Feed<Overview> }) {
  const s = docState(doc);
  const slices = s.data ? reviewSlices(s.data) : [];
  const total = slices.reduce((n, x) => n + x.value, 0);
  const state = s.card.state === 'ready' && total === 0 ? 'empty' : s.card.state;
  return (
    <ChartCard
      id="reviews"
      title="Reviews"
      info="Published or approved documents, by where their next review date stands. A draft, an expired or an archived document owes no review. A state nobody is in is left out. Each name opens the library on it."
      href={link(`${s.library}${s.library.includes('?') ? '&' : '?'}review=overdue`)}
      hrefLabel="Open the overdue reviews in the library"
      {...s.card}
      state={state}
      emptyText="No review is owed yet. Published and approved documents appear here once they have a review date."
      loadingHeight={180}
    >
      <DonutChart label="Documents by review state" slices={slices.map((x) => ({ ...x, href: x.href ? link(x.href) : undefined }))} centre={{ value: formatCount(total), caption: total === 1 ? 'document' : 'documents' }} noun="documents" />
    </ChartCard>
  );
}

// ── the departments: the biggest five, the rest in the Departments view ───────────────────────────────────────────────────
/** How many departments the Summary draws; the Departments view has them all in its table. */
export const DEPARTMENT_BARS = 5;

export function DepartmentsCard({ doc }: { doc: Feed<Overview> }) {
  const s = docState(doc);
  const stack = s.data && hasDepartmentTable(s.data) ? capStack(departmentStack(s.data, 'status'), DEPARTMENT_BARS) : null;
  const state = s.card.state === 'ready' && (!stack || stack.rows.length === 0) ? 'empty' : s.card.state;
  const all = s.data ? link(viewHref(s.data.scope.value, 'departments')) : undefined;
  return (
    <ChartCard
      id="by-department"
      title="Documents by department"
      meta={stack && stack.more > 0 ? `Top ${DEPARTMENT_BARS}, ${stack.more} more` : undefined}
      info="Documents that are not archived, by status, for each department and everything under it: the biggest five. A bar opens that department; the title opens all of them with their columns."
      href={all}
      hrefLabel="Open the departments"
      {...s.card}
      state={state}
      emptyText="No departments under this scope. Documents filed in the scope itself are in the figures above."
      loadingHeight={180}
    >
      {stack && (
        <StackedBars
          label="Documents by department and status"
          firstColumn="Department"
          categories={stack.rows.map((r) => ({ key: r.key, label: r.name, cells: r.cells, href: r.value ? link(viewHref(r.value)) : undefined }))}
          series={stack.series}
          nameWidth={130}
        />
      )}
    </ChartCard>
  );
}

// ── the people asked ─────────────────────────────────────────────────────────────────────────────────────────────────────
const WAITING_SERIES = [
  { key: 'overdue', label: 'Overdue', color: STATUS.bad },
  { key: 'soon', label: 'Due in 7 days', color: STATUS.warn },
  { key: 'later', label: 'Later', color: STATUS.pending },
] as const;

export function WaitingCard({ doc }: { doc: Feed<Overview> }) {
  const s = docState(doc);
  const bars = s.data ? requestBars(s.data) : [];
  const state = s.card.state === 'ready' && noRequests(bars) ? 'empty' : s.card.state;
  return (
    <ChartCard
      id="waiting"
      title="Waiting on people"
      info="Reviews, approvals and acknowledgements asked of people and not answered yet: one for each person asked, so a number can be larger than the documents it opens. Overdue is past the due date. A bar opens the library on the documents it counts, where it can."
      {...s.card}
      state={state}
      emptyText="Nobody has been asked anything yet. Reviews, approvals and acknowledgements appear here once they are."
      loadingHeight={180}
    >
      <StackedBars
        label="Requests waiting on people, by kind"
        firstColumn="Request"
        categories={bars.map((b) => ({
          key: b.kind, label: b.label, href: b.parts[2].href ? link(b.parts[2].href) : undefined,
          cells: { overdue: b.parts[0].value, soon: b.parts[1].value, later: b.parts[2].value },
        }))}
        series={WAITING_SERIES}
        nameWidth={130}
        height={150}
      />
    </ChartCard>
  );
}

// ── throughput ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function ThroughputCard({ trends, now, scoped }: { trends: Feed<TrendsAnswer>; now: Date; scoped: boolean }) {
  const rows = monthSeries(trends.data, now);
  const base = cardProps([trends]);
  const state = base.state === 'ready' && trendIsEmpty(rows) ? 'empty' : base.state;
  const said = wholeOrganisation(scoped, 'Documents created and documents published in each of the last six calendar months; the current month is still running.');
  return (
    <ChartCard
      id="throughput"
      title="Created and published"
      meta={said.meta}
      info={said.info}
      href={link(LIBRARY)}
      hrefLabel="Open the document library"
      {...base}
      state={state}
      emptyText="No documents created or published in the last six months. They appear here as documents are created and published."
      loadingHeight={220}
    >
      <TrendChart
        label="Documents created and published by month"
        firstColumn="Month"
        rows={rows.map((r) => ({ label: r.label, created: r.created, published: r.published }))}
        series={[{ key: 'created', label: 'Created', color: SERIES[0] }, { key: 'published', label: 'Published', color: SERIES[1] }]}
        variant="area"
        height={220}
      />
    </ChartCard>
  );
}

// ── what expires when ────────────────────────────────────────────────────────────────────────────────────────────────────
export function ExpiringCard({ expiring, scoped }: { expiring: Feed<ExpiringAnswer>; scoped: boolean }) {
  const rows = expiringRows(expiring.data);
  const base = cardProps([expiring]);
  const state = base.state === 'ready' && (rows.length === 0 || expiringIsEmpty(rows)) ? 'empty' : base.state;
  const said = wholeOrganisation(scoped, 'Documents reaching their expiry date in the next 90 days, whatever their status, in three windows from today. The first opens the library on them.');
  return (
    <ChartCard
      id="expiring"
      title="Expiring documents"
      meta={said.meta}
      info={said.info}
      href={link(`${LIBRARY}?expiry=30d`)}
      hrefLabel="Open the documents expiring in 30 days"
      {...base}
      state={state}
      emptyText="No document reaches its expiry date in the next 90 days."
      loadingHeight={150}
    >
      <BarList label="Documents expiring, by window" rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.value, href: r.href ? link(r.href) : undefined }))} nameWidth={110} />
    </ChartCard>
  );
}

// ── exceptions ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function ExceptionsCard({ exceptions, scoped }: { exceptions: Feed<ExceptionsAnswer>; scoped: boolean }) {
  const parts = exceptionParts(exceptions.data?.by_status);
  const total = exceptions.data?.total ?? 0;
  const base = cardProps([exceptions]);
  const state = base.state === 'ready' && total === 0 ? 'empty' : base.state;
  const expiring = exceptions.data?.expiring_soon ?? 0;
  const said = wholeOrganisation(scoped, 'Every exception by where it stands: along the route (draft, waiting for a decision, approved) and how it ended. Expiring soon: approved and lapsing within 30 days.');
  return (
    <ChartCard
      id="exceptions"
      title="Policy exceptions"
      meta={[state === 'ready' && expiring > 0 ? `${formatCount(expiring)} expiring soon` : '', said.meta].filter(Boolean).join(' · ') || undefined}
      info={said.info}
      href={link('/governance/exceptions')}
      hrefLabel="Open the policy exceptions"
      {...base}
      state={state}
      emptyText="No exceptions yet. They appear here once one is raised."
      loadingHeight={120}
    >
      <SegmentBar label="Exceptions by status" parts={parts.map((p) => ({ ...p, href: link('/governance/exceptions') }))} height={16} />
    </ChartCard>
  );
}
