'use client';

// The graphical part of the front door, under the figures: the review work in the first two rows (what is sent and decided each month, what waits and for how long, the files
// of each journey by decision, the requirements by scope) and the observations in the next two (priority by status, deadlines, registered and closed, regulators). The cards are
// the kit's ChartCards in its 12-column grid: level in height within a row, one per row on a phone, none folded away.
import type { UseQueryResult } from '@tanstack/react-query';
import { Cell, ChartGrid } from '@/components/overview/charts';
import type { WorkPayload } from '@/lib/auditorPortal/portalModel';
import type { ObservationSummary, WorkSummary } from '@/lib/auditorPortal/frontModel';
import { DeadlinesCard, HeatCard, RegisteredCard, RegulatorsCard } from './ObservationCards';
import { AgingCard, FlowCard, JourneyFilesCard, ScopeCard } from './ReviewCards';

export interface FrontVisualsProps {
  work: UseQueryResult<WorkPayload, Error>;
  summary: UseQueryResult<WorkSummary, Error>;
  observations: UseQueryResult<ObservationSummary, Error>;
}

export function FrontVisuals({ work, summary, observations }: FrontVisualsProps) {
  return (
    <ChartGrid>
      <Cell span={8}><FlowCard summary={summary} /></Cell>
      <Cell span={4}><AgingCard summary={summary} /></Cell>
      <Cell span={7}><JourneyFilesCard work={work} /></Cell>
      <Cell span={5}><ScopeCard work={work} summary={summary} /></Cell>
      <Cell span={6}><HeatCard observations={observations} /></Cell>
      <Cell span={6}><DeadlinesCard observations={observations} /></Cell>
      <Cell span={8}><RegisteredCard observations={observations} /></Cell>
      <Cell span={4}><RegulatorsCard observations={observations} /></Cell>
    </ChartGrid>
  );
}
