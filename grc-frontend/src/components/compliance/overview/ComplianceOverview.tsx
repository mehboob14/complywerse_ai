'use client';

/**
 * Compliance > Overview, a posture dashboard on the cockpit frame (components/overview), Overview v2: it says how the programme stands, in graphics, and the person's own work is one slim card after them.
 * Five figures lead (the score, Ready, Implemented, journeys due, evidence approved; Tiles.tsx), then seven cards (Charts.tsx: the six areas of the score and the framework journeys as small multiples, the
 * requirements and the evidence by status, the evidence freshness, the controls' measures, the daily record), then "My work" (the shared inbox narrowed to evidence to approve; three one-line rows and
 * "See all"). There is no wall of counters: what needs attention is the colour of the graphics (a weak area is red, a lapsed file is a red bar) and the number rides on the area's tile. The formulas
 * are behind "How is it scored?", the pages the old tiles opened are in the strip under the heading, and every tile, card title, bar, slice and framework opens its module (filtered where the module can be).
 * What changes what the page shows lives in the address: the history's period `?period=` and the open "How is it scored?" `?how=1`; `useReturnToPlace` puts a person who comes back (Back, or a module's
 * own back link) on the same view at the same scroll position once the data has rendered.
 * Every request loads, fails and has nothing on its own (a failed load used to read as "score -, nothing needs attention"), and every graph is drawn from an answer the page already has: the score is the
 * server's (GET /compliance/policies/dashboard/sections-overview, query key and payload unchanged: the main Dashboard reads the same key); the journeys' figures are lib/journeyModel.ts's; lapsed
 * evidence is the evidence summary's; the history is the Frameworks hub's key. Rules and words: overviewModel.ts, graphModel.ts.
 */
import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, IconButton, Notice, useAddressState } from '@/components/ui/ds';
import { statusOf } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork } from '@/components/overview/Cockpit';
import { MyWorkCard } from '@/components/overview/MyWorkCard';
import { useReturnToPlace } from '@/components/overview/useReturnToPlace';
import { workOf } from '@/components/overview/workList';
import { usePermissions } from '@/hooks/usePermissions';
import { flag, oneOf } from '@/lib/addressState';
import { useInbox } from '@/lib/inbox/inboxApi';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import { Charts } from './Charts';
import { ComplianceStrip } from './ComplianceStrip';
import { DEFAULT_PERIOD, HERO_DAYS, PERIODS, daysOf } from './graphModel';
import { Tiles } from './Tiles';
import { useEvidenceSummary, useJourneys, useScorecard, useTrend } from './overviewData';
import { AreasSheet } from './OverviewParts';
import { COMPLIANCE_SOURCES, postureOf, sectionRows } from './overviewModel';

/** Defined once, outside the component (useAddressState reads the address again for a new schema). */
const SCHEMA = {
  period: oneOf<string>(PERIODS.map((p) => p.value), DEFAULT_PERIOD),
  how: flag(),
};

export default function ComplianceOverview() {
  const { isAdmin } = usePermissions();
  const [address, setAddress] = useAddressState(SCHEMA);
  const { period, how } = address;

  const scorecard = useScorecard();
  const evidence = useEvidenceSummary();
  const journeys = useJourneys();
  const trendTiles = useTrend(HERO_DAYS);                  // the tiles' shape is always the last 90 days; the chart's period is the person's (the default is the same key)
  const trend = useTrend(daysOf(period));
  const { inbox, refetch: refetchInbox, fetchingSource } = useInbox({ freshOnOpen: true });
  const work = workOf(inbox, COMPLIANCE_SOURCES);

  // no right to read the scorecard: said once, the person's own work takes the page
  const refused = scorecard.isError && statusOf(scorecard.error) === 403;

  const payload = scorecard.data;
  const posture = postureOf(payload?.performance);
  const sections: OverviewSection[] = useMemo(() => sectionRows(payload?.sections).map((r) => payload?.sections?.[r.key] as OverviewSection).filter(Boolean).map((s) => ({ ...s, counts: s.counts ?? {} })), [payload]);

  // the page is drawn once every request has answered or failed: that is when the place a person left is put back
  useReturnToPlace(!scorecard.isPending && !evidence.isPending && !journeys.isPending && !trend.isPending);

  const refreshAll = () => {
    [scorecard, evidence, journeys, trendTiles, trend].forEach((q) => { void q.refetch(); });
    refetchInbox();
  };
  const updated = scorecard.dataUpdatedAt > 0 ? `Updated ${clockOf(scorecard.dataUpdatedAt)}` : undefined;

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title={titleFor('/compliance') ?? 'Compliance Overview'}
        info="Where the compliance programme stands, and what needs you."
        meta={<span className="inline-flex items-center gap-[2px]">{updated}<IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton></span>}
        actions={<Button href="/frameworks" variant="primary">Frameworks</Button>}
      />
      <ComplianceStrip current="overview" />

      <Cockpit
        mode={refused ? 'work-only' : 'full'}
        refusal={(
          <Notice tone="info" title="No access to the compliance scores">
            Your account cannot read the compliance scorecard, so the scores are not shown. Your own work below is unaffected. Ask an administrator for access if you need them.
          </Notice>
        )}
        hero={<Tiles scorecard={scorecard} journeys={journeys} evidence={evidence} trend={trendTiles} />}
        visuals={<Charts scorecard={scorecard} journeys={journeys} evidence={evidence} trend={trend} period={period} onPeriod={(value) => setAddress({ period: value })} onOpenAreas={() => setAddress({ how: true })} />}
        work={(
          <MyWorkCard
            id="work"
            title="My work"
            info="Evidence waiting for your decision, the most urgent first. The same list as the top bar and the Needs my action page, for Compliance."
            work={work}
            onRetry={(source) => refetchInbox(source)}
            fetching={fetchingSource}
          />
        )}
      />

      <AreasSheet open={how} onClose={() => setAddress({ how: false })} sections={sections} score={posture.score} grade={posture.grade} canTune={isAdmin} />
    </div>
  );
}
