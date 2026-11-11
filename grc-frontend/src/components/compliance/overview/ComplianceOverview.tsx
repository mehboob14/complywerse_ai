'use client';

/**
 * Compliance > Overview, a dashboard on the worklist-first cockpit (the frame the Governance and Risk Management Overviews use: components/overview). It leads with six figures (the score,
 * Ready, Implemented, open requirements, journeys due, evidence approved; Tiles.tsx) and the counters of what needs attention (a band whose total is their sum), then ten graphs (Charts.tsx:
 * the score by area, journeys by stage and date, requirements by status per journey, Ready by journey, the daily record, where the open work is, evidence by status / freshness / month, the
 * measures behind each area), then the person's own work ("Needs my action", the shared inbox narrowed to evidence to approve) beside the weakest areas, and the tables below (one row per
 * framework journey, coverage, onboarding). The formulas are behind "How is it scored?", the pages the old tiles opened are in the strip under the heading.
 * Every request loads, fails and has nothing on its own (a failed load used to read as "score -, nothing needs attention"), and every graph is drawn from an answer the page already has:
 * the score and its counters are the server's (GET /compliance/policies/dashboard/sections-overview, query key and payload unchanged: the main Dashboard reads the same key); the journeys'
 * figures are lib/journeyModel.ts's; lapsed evidence is the evidence summary's; the history is the Frameworks hub's key. Rules and words: overviewModel.ts, graphModel.ts.
 */
import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, IconButton, Notice } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { WorkListCard } from '@/components/overview/WorkListCard';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { workOf, type WorkFilter } from '@/components/overview/workList';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount } from '@/lib/format';
import { useInbox } from '@/lib/inbox/inboxApi';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import { Charts } from './Charts';
import { ComplianceStrip } from './ComplianceStrip';
import { DEFAULT_PERIOD, HERO_DAYS, daysOf } from './graphModel';
import { Tiles } from './Tiles';
import { useEvidenceSummary, useJourneys, useOnboardingRegister, useScorecard, useTrend } from './overviewData';
import { AreasSheet, CoverageBody, FrameworkRows, OnboardingBody, PostureCard } from './OverviewParts';
import {
  ATTENTION, COMPLIANCE_SOURCES, allFailed, attentionTotal, counterFor, coverageRows, journeyRows, onboardingOf, portfolioLine, postureOf, sectionRows, weakest,
  type EvidenceFeed, type ScorecardFeed,
} from './overviewModel';

const identity = (href: string): string => href;
const FIRST_JOURNEYS = 8;

export default function ComplianceOverview() {
  const narrow = useNarrow();
  const { isAdmin } = usePermissions();
  const [filter, setFilter] = useState<WorkFilter>('all');
  const [areasOpen, setAreasOpen] = useState(false);
  const [journeysShown, setJourneysShown] = useState(FIRST_JOURNEYS);
  const [period, setPeriod] = useState(DEFAULT_PERIOD);

  const scorecard = useScorecard();
  const evidence = useEvidenceSummary();
  const journeys = useJourneys();
  const register = useOnboardingRegister();
  const trendTiles = useTrend(HERO_DAYS);                  // the tiles' shape is always the last 90 days; the chart's period is the person's (the default is the same key)
  const trend = useTrend(daysOf(period));
  const { inbox, refetch: refetchInbox, fetchingSource } = useInbox({ freshOnOpen: true });
  const work = workOf(inbox, COMPLIANCE_SOURCES);

  const payload = scorecard.data;
  const scorecardFeed: ScorecardFeed = { pending: scorecard.isPending, failed: scorecard.isError && !payload, queue: payload?.attention_queue };
  const evidenceFeed: EvidenceFeed = { pending: evidence.isPending, failed: evidence.isError && !evidence.data, summary: evidence.data };

  // the band: four counters, each from the request that knows it, and the total is their sum
  const views = ATTENTION.map((def) => counterFor(def, scorecardFeed, evidenceFeed));
  const total = attentionTotal(views);
  const counters: BandCounter[] = ATTENTION.map((def, i) => {
    const q = def.from === 'scorecard' ? scorecard : evidence;
    return {
      key: def.key, label: def.label, href: def.href, tone: def.tone, state: views[i].state, value: views[i].value,
      onRetry: views[i].state === 'error' && canRetry(q.error) ? () => { void q.refetch(); } : undefined,
    };
  });
  const everyCounterFailed = allFailed(views);

  // no right to read the scorecard: said once, the person's own work takes the page
  const refused = scorecard.isError && statusOf(scorecard.error) === 403;
  const mode = layoutOf({ refused, workCount: work.state === 'content' || work.state === 'empty' ? work.counts.all : null });

  const posture = postureOf(payload?.performance);
  const sections: OverviewSection[] = useMemo(() => sectionRows(payload?.sections).map((r) => payload?.sections?.[r.key] as OverviewSection).filter(Boolean).map((s) => ({ ...s, counts: s.counts ?? {} })), [payload]);
  const weak = weakest(sectionRows(payload?.sections));

  const rows = useMemo(() => journeyRows(journeys.data), [journeys.data]);
  const portfolio = useMemo(() => portfolioLine(journeys.data), [journeys.data]);
  const coverage = coverageRows({ ...scorecardFeed, sections: payload?.sections }, evidenceFeed);
  const onboarding = onboardingOf(register.data);

  const refreshAll = () => {
    [scorecard, evidence, journeys, register, trendTiles, trend].forEach((q) => { void q.refetch(); });
    refetchInbox();
  };
  const updated = scorecard.dataUpdatedAt > 0 ? `Updated ${clockOf(scorecard.dataUpdatedAt)}` : undefined;

  const breakdowns: Breakdown[] = [
    {
      id: 'by-framework',
      title: 'By framework',
      info: 'Each framework journey with the share of its requirements that have approved evidence (Ready) and the share that are implemented. Requirements put out of scope are left out. The most urgent first.',
      meta: journeys.isPending || journeys.isError ? undefined : `${formatCount(portfolio.journeys)} active${portfolio.completed ? ` · ${formatCount(portfolio.completed)} finished` : ''}`,
      actions: <Button size="sm" href="/frameworks">Open Frameworks</Button>,
      size: 'wide',
      children: <FrameworkRows q={journeys} rows={rows} shown={journeysShown} onMore={() => setJourneysShown(rows.length)} />,
    },
    {
      id: 'coverage',
      title: 'Coverage',
      info: 'The gaps behind the score that are not in "needs attention": controls not yet verified or tested, policy statements judged compliant, and evidence waiting for a decision or ending within 30 days.',
      children: <CoverageBody rows={coverage} retry={{ scorecard: () => { void scorecard.refetch(); }, evidence: () => { void evidence.refetch(); } }} />,
    },
    {
      id: 'onboarding',
      title: 'Onboarding',
      info: 'A framework journey starts once its onboarding is settled. This is where the frameworks stand, and whether the organisation profile every journey needs is complete.',
      actions: <Button size="sm" href="/frameworks/onboarding">Open onboarding</Button>,
      children: <OnboardingBody q={register} view={onboarding} />,
    },
  ];

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
        mode={mode}
        narrow={narrow}
        refusal={(
          <Notice tone="info" title="No access to the compliance scores">
            Your account cannot read the compliance scorecard, so the scores are not shown. Your own work below is unaffected. Ask an administrator for access if you need them.
          </Notice>
        )}
        hero={<Tiles scorecard={scorecard} journeys={journeys} evidence={evidence} trend={trendTiles} />}
        visuals={<Charts scorecard={scorecard} journeys={journeys} evidence={evidence} trend={trend} period={period} onPeriod={setPeriod} onOpenAreas={() => setAreasOpen(true)} />}
        band={(
          <CounterBand
            id="attention"
            title="Needs attention"
            info="Each count opens the records it counts, or the page that lists them. The total is the sum of the four."
            total={total !== null ? `${formatCount(total)} in total` : undefined}
            counters={counters}
            narrow={narrow}
            failure={everyCounterFailed ? {
              title: "Couldn't load what needs attention",
              message: errorMessage(scorecard.error ?? evidence.error),
              onRetry: canRetry(scorecard.error ?? evidence.error) ? () => { void scorecard.refetch(); void evidence.refetch(); } : undefined,
            } : undefined}
          />
        )}
        work={(
          <WorkListCard
            id="work"
            title="Needs my action"
            info="Evidence waiting for your decision, the most urgent first. The same list as the top bar and the Needs my action page, for Compliance."
            work={work}
            filter={filter}
            onFilter={setFilter}
            limit={workRowLimit(mode, narrow)}
            onRetry={(source) => refetchInbox(source)}
            fetching={fetchingSource}
            link={identity}
          />
        )}
        posture={(
          <PostureCard id="posture" scorecard={scorecard} weak={weak} onOpenAreas={() => setAreasOpen(true)} />
        )}
        breakdowns={breakdowns}
      />

      <AreasSheet open={areasOpen} onClose={() => setAreasOpen(false)} sections={sections} score={posture.score} grade={posture.grade} canTune={isAdmin} />
    </div>
  );
}
