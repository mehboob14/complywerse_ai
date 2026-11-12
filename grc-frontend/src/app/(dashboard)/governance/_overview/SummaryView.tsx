'use client';

// The Summary: how governance stands, in graphics. Five figures (the score and how it moved, the documents, the coverage, the one "Needs attention" tile that opens the
// board, what was published), then the cards: section scores in their status colour, documents by status and by type, the review dates, the people asked, the biggest
// five departments, what was created and published, what expires and the exceptions; the person's own work (at most three one-line rows) last. Every measure is
// drawn once (sections.ts says what each card shows, and its test keeps the list honest); the title of a card and every bar, slice and tile open the module's own list.
// A person who may not read the programme scores sees that once and their own work takes the page. The cards of the documents are the scope's (the department picked); the
// scores, the throughput, the expiry and the exceptions are the whole organisation's and say so. Layout: a zigzag of 7 and 5 columns on a wide screen.
import { Lock } from 'lucide-react';
import { Cell, ChartGrid } from '@/components/overview/charts';
import { SkipToWork } from '@/components/overview/Cockpit';
import { MyWorkCard } from '@/components/overview/MyWorkCard';
import type { Work } from '@/components/overview/workList';
import { Notice } from '@/components/ui/ds';
import type { SourceId } from '@/lib/inbox/buildInbox';
import { DepartmentsCard, ExceptionsCard, ExpiringCard, ReviewsCard, SectionScoresCard, StatusCard, ThroughputCard, TypeCard, WaitingCard } from './Charts';
import { Hero, type HeroFeeds } from './Hero';
import { link, refused, type Feed } from './parts';
import type { Scorecard } from './overviewModel';
import type { Overview } from './docs/_model';
import type { ExceptionsAnswer, ExpiringAnswer, HeroInputs, TrendsAnswer } from './visualsModel';

export interface SummaryFeeds {
  scorecard: Feed<Scorecard>;
  doc: Feed<Overview>;
  trends: Feed<TrendsAnswer>;
  expiring: Feed<ExpiringAnswer>;
  exceptions: Feed<ExceptionsAnswer>;
}

export function SummaryView({ feeds, work, onRetryWork, fetchingWork, scoped, now, onHow }: {
  feeds: SummaryFeeds;
  work: Work;
  onRetryWork: (source: SourceId) => void;
  fetchingWork: Partial<Record<SourceId, boolean>>;
  scoped: boolean;
  now: Date;
  onHow: () => void;
}) {
  // no right to read the scorecard (every Governance dashboard feed shares one rule): said once, the person's own work takes the page
  if (refused(feeds.scorecard)) {
    return (
      <div className="flex flex-col gap-[16px]">
        <Notice tone="info" icon={Lock} title="No access to the programme scores">
          Your account cannot read the Governance document library, so the programme scores are not shown. Your own work below and the Departments and Board views are unaffected. Ask an administrator for library access if you need the scores.
        </Notice>
        <MyWorkCard work={work} onRetry={onRetryWork} fetching={fetchingWork} link={link} />
      </div>
    );
  }
  const inputs: HeroInputs = { scorecard: feeds.scorecard, doc: feeds.doc, trends: feeds.trends, scoped, now };
  const heroFeeds: HeroFeeds = { scorecard: feeds.scorecard, doc: feeds.doc, trends: feeds.trends };
  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <Hero inputs={inputs} feeds={heroFeeds} />
      <ChartGrid>
        <Cell span={7}><SectionScoresCard scorecard={feeds.scorecard} scoped={scoped} onHow={onHow} /></Cell>
        <Cell span={5}><StatusCard doc={feeds.doc} /></Cell>
        <Cell span={4}><TypeCard doc={feeds.doc} /></Cell>
        <Cell span={4}><ReviewsCard doc={feeds.doc} /></Cell>
        <Cell span={4}><WaitingCard doc={feeds.doc} /></Cell>
        <Cell span={6}><DepartmentsCard doc={feeds.doc} /></Cell>
        <Cell span={6}><ThroughputCard trends={feeds.trends} now={now} scoped={scoped} /></Cell>
        <Cell span={4}><ExpiringCard expiring={feeds.expiring} scoped={scoped} /></Cell>
        <Cell span={4}><ExceptionsCard exceptions={feeds.exceptions} scoped={scoped} /></Cell>
        <Cell span={4}><MyWorkCard work={work} onRetry={onRetryWork} fetching={fetchingWork} link={link} /></Cell>
      </ChartGrid>
    </div>
  );
}
