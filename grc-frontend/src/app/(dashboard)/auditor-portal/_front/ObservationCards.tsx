'use client';

// The front door's graphs of the observations (Statutory Audit): priority by status as a grid, the open ones by where they stand against their deadline and the five regulators with the most
// open (the monthly registered and closed bars left the front door: the tile keeps this month's figures and the register has the history). They read GET /auditor-portal/statutory-audit/observations/summary, which counts as the register's own chips do, so a number here is the
// number in the register. A cell, a bar or a chip that has something behind it opens the register on it.
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { clsx } from 'clsx';
import { BarList, ChartCard, Heatmap } from '@/components/overview/charts';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { formatCount } from '@/lib/format';
import { observationPriority } from '@/lib/statuses/statutory';
import { deadlineRows, observationHeat, type ObservationSummary } from '@/lib/auditorPortal/frontModel';
import { cardState } from './cardState';
import { STATUTORY, topRegulators } from './frontRules';

type Feed = { observations: UseQueryResult<ObservationSummary, Error> };

const NO_ACCESS = 'Your role cannot see observations.';
const NONE_YET = 'No observations yet. Register one in Statutory Audit and it appears here.';

export function HeatCard({ observations }: Feed) {
  const data = observations.data;
  const heat = observationHeat(data, (p) => observationPriority.label(p));
  return (
    <ChartCard
      id="obs-heat"
      title="Priority by status"
      meta={data ? formatCount(data.total) : undefined}
      info="Every observation by its priority and its status (the organisation's own status levels). A cell opens the register on that priority and status."
      href={STATUTORY}
      hrefLabel="Open Statutory Audit"
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
      title="Open by deadline"
      meta={data ? formatCount(data.open) : undefined}
      href={STATUTORY}
      hrefLabel="Open the observations in Statutory Audit"
      info="Open observations by where they stand against their due date or SLA, read as the register's chips read it: Overdue is past its date, Due in 30 days is the next month. A bar with something in it opens the register on that chip."
      loadingHeight={190}
      {...cardState(observations, !rows || (data?.open ?? 0) === 0, NO_ACCESS)}
      emptyText={(data?.total ?? 0) === 0 ? NONE_YET : 'No observation is open.'}
    >
      {rows && <BarList label="Open observations by deadline" rows={rows.map(({ note: _note, ...r }) => r)} nameWidth={130} />}
    </ChartCard>
  );
}

export function RegulatorsCard({ observations }: Feed) {
  const data = observations.data;
  const top = topRegulators(data);
  return (
    <ChartCard
      id="obs-regulators"
      title="Open by regulator"
      href={STATUTORY}
      hrefLabel="Open the observations in Statutory Audit"
      info="Open observations by the regulator or source recorded on them, the five with the most open. A bar opens the register on that regulator."
      loadingHeight={190}
      {...cardState(observations, !top || top.rows.length === 0, NO_ACCESS)}
      emptyText={(data?.total ?? 0) === 0 ? NONE_YET : 'No observation is open.'}
    >
      {top && <BarList label="Open observations by regulator" rows={top.rows} nameWidth={100} />}
      {top && top.more > 0 && <Link href={STATUTORY} className={clsx('mt-[8px] inline-block', linkClasses({ tone: 'text', size: 'label' }))}>{`See all ${formatCount(top.rows.length + top.more)}`}</Link>}
    </ChartCard>
  );
}
