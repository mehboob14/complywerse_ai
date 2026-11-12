'use client';

// The front door's graphs of the review work: requests sent and decided per month, what waits by how long it has waited, and the requirements by where their scope decision stands (the
// journeys are JourneyTiles). Every number is the server's (GET /auditor-portal/work and /work/summary); each card has its own state (see cardState).
import type { UseQueryResult } from '@tanstack/react-query';
import { ChartCard, DonutChart, SERIES, StackedBars, TrendChart } from '@/components/overview/charts';
import { formatCount } from '@/lib/format';
import type { WorkPayload } from '@/lib/auditorPortal/portalModel';
import {
  agingCategories, agingTotal, flowRows, hasFlow, scopeSlices, type WorkSummary,
} from '@/lib/auditorPortal/frontModel';
import { cardState } from './cardState';

interface Feeds {
  work: UseQueryResult<WorkPayload, Error>;
  summary: UseQueryResult<WorkSummary, Error>;
}

export function FlowCard({ summary, href }: Pick<Feeds, 'summary'> & { href?: string }) {
  const rows = flowRows(summary.data);
  return (
    <ChartCard
      id="flow"
      title="Sent and decided"
      meta="By month"
      href={href}
      hrefLabel="Open the review queue"
      info="Per calendar month: files sent for review and scope requests asked, against files and scope requests an auditor approved or turned down. The last month is the month so far. When the bars for decided stay under the bars for sent, the waiting list grows."
      loadingHeight={240}
      {...cardState(summary, !rows || !hasFlow(rows))}
      emptyText="No history yet. It builds up as files are sent for review and decided."
    >
      {rows && (
        <TrendChart
          label="Requests sent and decided by month"
          firstColumn="Month"
          rows={rows}
          series={[{ key: 'sent', label: 'Sent or asked', color: SERIES[0] }, { key: 'decided', label: 'Decided', color: SERIES[2] }]}
          variant="bars"
          height={240}
        />
      )}
    </ChartCard>
  );
}

export function AgingCard({ summary, href }: Pick<Feeds, 'summary'> & { href?: string }) {
  const cats = agingCategories(summary.data);
  const total = agingTotal(cats);
  const undated = (summary.data?.aging.undated.files ?? 0) + (summary.data?.aging.undated.scope ?? 0);
  return (
    <ChartCard
      id="aging"
      title="Waiting, by age"
      meta={summary.data ? `${formatCount(total)}${undated > 0 ? ` · ${formatCount(undated)} no date` : ''}` : undefined}
      href={href}
      hrefLabel="Open the review queue"
      info="Files and scope requests still waiting for a decision, by how many days they have waited since they were sent or asked. The oldest are the ones to decide first."
      loadingHeight={190}
      {...cardState(summary, !cats || total === 0)}
      emptyText="Nothing is waiting. Files and scope requests that wait appear here by age."
    >
      {cats && (
        <StackedBars
          label="Waiting files and scope requests by age"
          firstColumn="Waiting for"
          categories={cats}
          series={[{ key: 'files', label: 'Files', color: SERIES[0] }, { key: 'scope', label: 'Scope requests', color: SERIES[1] }]}
          nameWidth={96}
        />
      )}
    </ChartCard>
  );
}

export function ScopeCard({ work, summary, href }: Feeds & { href?: string }) {
  const slices = scopeSlices(summary.data?.scope_totals, work.data?.journeys ?? []);
  const total = summary.data?.scope_totals.controls ?? 0;
  return (
    <ChartCard
      id="scope"
      title="Requirements by scope"
      meta={summary.data ? formatCount(total) : undefined}
      href={href}
      hrefLabel="Open the scope requests waiting for a decision"
      info="Every requirement of the frameworks the journeys follow, by where its scope decision stands: approved into scope, approved out of scope, waiting for a reviewer, turned down, or never asked about. A framework shared by two journeys counts once."
      loadingHeight={180}
      {...cardState(summary, !slices || total === 0)}
      emptyText="No requirements yet. They appear here once a journey follows a framework."
    >
      {slices && <DonutChart label="Requirements by scope decision" slices={slices} centre={{ value: formatCount(total), caption: 'in all' }} noun="requirements" />}
    </ChartCard>
  );
}
