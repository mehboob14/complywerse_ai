'use client';

// The front door's graphs of the observations (Statutory Audit): priority by status as a grid, the open ones by where they stand against their deadline, registered and closed per
// month, and the open ones by regulator. They read GET /auditor-portal/statutory-audit/observations/summary, which counts as the register's own chips do, so a number here is the
// number in the register. A cell, a bar or a chip that has something behind it opens the register on it.
import type { UseQueryResult } from '@tanstack/react-query';
import { BarList, ChartCard, Heatmap, SERIES, TrendChart } from '@/components/overview/charts';
import { Button } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { observationPriority } from '@/lib/statuses/statutory';
import { deadlineRows, observationHeat, openedClosedRows, regulatorRows, type ObservationSummary } from '@/lib/auditorPortal/frontModel';
import { cardState } from './cardState';

type Feed = { observations: UseQueryResult<ObservationSummary, Error> };

const NO_ACCESS = 'Your role cannot see observations.';
const NONE_YET = 'No observations yet. Register one in Statutory Audit and it appears here.';

export function HeatCard({ observations }: Feed) {
  const data = observations.data;
  const heat = observationHeat(data, (p) => observationPriority.label(p));
  return (
    <ChartCard
      id="obs-heat"
      title="Observations by priority and status"
      meta={data ? `${formatCount(data.total)} in all` : undefined}
      info="Every observation by its priority and its status (the organisation's own status levels). A cell opens the register on that priority and status."
      actions={<Button href="/auditor-portal/statutory-audit" variant="link" size="sm">Open Statutory Audit</Button>}
      loadingHeight={200}
      {...cardState(observations, !heat || (data?.total ?? 0) === 0, NO_ACCESS)}
      emptyText={NONE_YET}
    >
      {heat && (
        <Heatmap label="Observations by priority and status" rowTitle="Priority" colTitle="Status" rows={heat.rows} cols={heat.cols} cells={heat.cells} href={heat.href} max={heat.max} noun="observations" />
      )}
    </ChartCard>
  );
}

export function DeadlinesCard({ observations }: Feed) {
  const data = observations.data;
  const rows = deadlineRows(data);
  return (
    <ChartCard
      id="obs-deadlines"
      title="Open observations by deadline"
      meta={data ? `${formatCount(data.open)} open` : undefined}
      info="Open observations by where they stand against their due date or SLA, read as the register's chips read it: Overdue is past its date, Due in 30 days is the next month. A bar with something in it opens the register on that chip."
      loadingHeight={190}
      {...cardState(observations, !rows || (data?.open ?? 0) === 0, NO_ACCESS)}
      emptyText={(data?.total ?? 0) === 0 ? NONE_YET : 'No observation is open.'}
    >
      {rows && <BarList label="Open observations by deadline" rows={rows} nameWidth={130} />}
    </ChartCard>
  );
}

export function RegisteredCard({ observations }: Feed) {
  const rows = openedClosedRows(observations.data);
  const any = !!rows && rows.some((r) => Number(r.opened) > 0 || Number(r.closed) > 0);
  return (
    <ChartCard
      id="obs-trend"
      title="Registered and closed"
      meta="By month"
      info="Observations registered and observations closed in each calendar month. The last month is the month so far."
      loadingHeight={220}
      {...cardState(observations, !rows || !any, NO_ACCESS)}
      emptyText="No history yet. It builds up as observations are registered and closed."
    >
      {rows && (
        <TrendChart
          label="Observations registered and closed by month"
          firstColumn="Month"
          rows={rows}
          series={[{ key: 'opened', label: 'Registered', color: SERIES[0] }, { key: 'closed', label: 'Closed', color: SERIES[2] }]}
          variant="bars"
          height={220}
        />
      )}
    </ChartCard>
  );
}

export function RegulatorsCard({ observations }: Feed) {
  const data = observations.data;
  const rows = regulatorRows(data);
  return (
    <ChartCard
      id="obs-regulators"
      title="Open by regulator"
      info="Open observations by the regulator or source recorded on them, the six with the most open and the rest together. A bar opens the register on that regulator."
      loadingHeight={190}
      {...cardState(observations, !rows || rows.length === 0, NO_ACCESS)}
      emptyText={(data?.total ?? 0) === 0 ? NONE_YET : 'No observation is open.'}
    >
      {rows && <BarList label="Open observations by regulator" rows={rows} nameWidth={120} />}
    </ChartCard>
  );
}
