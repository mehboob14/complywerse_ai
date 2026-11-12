'use client';

// The graphical part of the front door, under the figures, in three rows: the review work (what is sent and decided each month, what waits and for how long), the journeys under audit as small
// multiples beside the requirements by scope, and the observations (priority by status, deadlines, regulators). The cards are the kit's ChartCards in its 12-column grid: level in height within a
// row, one per row on a phone, none folded away; the title of each carries an "Open" link and the parts of each open the records. Where the queue is per journey and several journeys have work waiting,
// "Open" goes to the journey tiles (the anchor), because there is no list across them.
import type { UseQueryResult } from '@tanstack/react-query';
import { Cell, ChartGrid } from '@/components/overview/charts';
import { counterTarget, type WorkPayload } from '@/lib/auditorPortal/portalModel';
import type { ObservationSummary, WorkSummary } from '@/lib/auditorPortal/frontModel';
import { JourneyTiles } from './JourneyTiles';
import { DeadlinesCard, HeatCard, RegulatorsCard } from './ObservationCards';
import { AgingCard, FlowCard, ScopeCard } from './ReviewCards';

export interface FrontVisualsProps {
  work: UseQueryResult<WorkPayload, Error>;
  summary: UseQueryResult<WorkSummary, Error>;
  observations: UseQueryResult<ObservationSummary, Error>;
}

export function FrontVisuals({ work, summary, observations }: FrontVisualsProps) {
  const cards = work.data?.journeys ?? [];
  const files = work.data ? counterTarget('files', cards) : undefined;
  const scope = work.data ? counterTarget('scope', cards) : undefined;
  return (
    <ChartGrid>
      <Cell span={8}><FlowCard summary={summary} href={files} /></Cell>
      <Cell span={4}><AgingCard summary={summary} href={files} /></Cell>
      <Cell span={8}><JourneyTiles work={work} /></Cell>
      <Cell span={4}><ScopeCard work={work} summary={summary} href={scope} /></Cell>
      <Cell span={4}><HeatCard observations={observations} /></Cell>
      <Cell span={4}><DeadlinesCard observations={observations} /></Cell>
      <Cell span={4}><RegulatorsCard observations={observations} /></Cell>
    </ChartGrid>
  );
}
