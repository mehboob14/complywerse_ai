'use client';

// "Journeys" on the front door as small multiples (Overview rules R1 and R4): one tile per certification journey instead of a list of cards. The ring is the share of the journey's files that are
// decided, green when nothing waits on it, amber when a file or a scope request does, grey when it has no file yet (nothing to decide is not 0%); the tooltip and the accessible name say the
// colour in words and carry what waits. Each tile opens that journey's review queue; more than twelve end in "See all N" (the framework workspace). The tiles are frontRules.ts journeyTiles.
import type { UseQueryResult } from '@tanstack/react-query';
import { AreaTiles, ChartCard } from '@/components/overview/charts';
import type { WorkPayload } from '@/lib/auditorPortal/portalModel';
import { FRAMEWORKS, JOURNEYS_ANCHOR, JOURNEY_WORDS, journeyTiles } from './frontRules';
import { cardState } from './cardState';

export function JourneyTiles({ work }: { work: UseQueryResult<WorkPayload, Error> }) {
  const items = journeyTiles(work.data?.journeys ?? []);
  return (
    <ChartCard
      id={JOURNEYS_ANCHOR.slice(1)}
      title="Journeys"
      info="Every certification journey of the organisation, the ones with the most waiting first. The ring is the share of its files already decided; amber means a file or a scope request waits for a decision, green that nothing does. A tile opens that journey's review queue; the requirements themselves are in Frameworks."
      href={FRAMEWORKS}
      hrefLabel="Open Frameworks, where the journeys start"
      loadingHeight={200}
      {...cardState(work, items.length === 0)}
      emptyText="No journeys to audit yet. Start one from a framework."
    >
      <AreaTiles label="Journeys by share of files decided" items={items} max={12} moreHref={FRAMEWORKS} words={JOURNEY_WORDS} />
    </ChartCard>
  );
}
