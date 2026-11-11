'use client';

/**
 * The graphs of the Compliance Overview, ten cards on the kit's 12-column grid (components/overview/charts): the score by area, the journeys by stage and by date, requirements by status per
 * journey, Ready by journey, the daily record of Implemented and Ready, where the open work is, the evidence by status, by freshness and by month, and the measures behind each area's score.
 * Every card is drawn from an answer the page already has (graphModel.ts says how), loads, fails (with Retry) and has nothing on its own, and a failed or refused request is never a chart of
 * zeros. A bar, a slice or a legend part that opens records is a link. A percentage here is one the platform already defines (the server's scores and measures, the journey model's Ready and
 * Implemented); the cards that show counts show counts, and each card says what it counts in its (i).
 */
import { useMemo } from 'react';
import Link from 'next/link';
import {
  BarList, Cell, ChartCard, ChartGrid, DonutChart, SegmentBar, StackedBars, TrendChart, SERIES, STATUS,
  type ChartCardProps,
} from '@/components/overview/charts';
import { Button, SegmentedControl, StatusPill } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { areaBand } from '@/lib/statuses/complianceStatements';
import {
  PERIODS, areaBars, feedState, domainBars, dueParts, evidenceFlow, evidenceParts, figuresOf, freshnessBars, measureGroups, readyBars, requirementStack, stageParts, trendRows,
  type TrendPointLite,
} from './graphModel';
import type { Scorecard } from './overviewData';
import { journeyRows, sectionRows, targetOf, type EvidenceSummaryLite, type JourneyListItem } from './overviewModel';
import { failureOf, type Feed } from './Tiles';

type Shown = Pick<ChartCardProps, 'state' | 'error' | 'deniedText'>;

/** One card's state from its request (graphModel.feedState): loading, "No access" (the server refused), failed with Retry, nothing to show, or the chart. */
function shown(q: Feed<unknown>, hasContent: boolean, denied: string): Shown {
  const state = feedState(q, hasContent);
  if (state === 'denied') return { state, deniedText: denied };
  if (state === 'error') {
    const failed = failureOf(q, '');
    return { state, error: { message: failed?.message, onRetry: failed?.onRetry } };
  }
  return { state };
}

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

const INFO_AREAS = 'The six areas of the compliance score, worked out by the server: 80 and over is strong, 60 and over fair, below that weak. The areas that pull the score down come first; the weight is the share of the score an area carries.';
const INFO_JOURNEYS = 'Every framework journey by the stage it is in, and the ones with work in them by their target date (within 30 days, or past it, is "due"). A journey that is finished or cancelled has no due date to meet.';
const INFO_STACK = 'The requirements of each journey with work in it, by where they stand: implemented (the verified ones counted once), in progress, not started. Requirements put out of scope are left out. Counts, not shares. The most urgent journeys come first; a bar opens its journey.';
const INFO_READY = 'Ready is the share of requirements whose approved evidence meets what they ask for, out of the requirements in scope. The lowest come first. Strong is 75 and over, building 50, early 25, below that just starting.';
const INFO_TREND = 'The platform\'s daily record of Implemented and Ready, controls-weighted over every journey that has a snapshot. It grows when a snapshot is captured on a journey; a day without one is not drawn.';
const INFO_DOMAINS = 'The domains of the journeys with the most requirements still to do (not started plus in progress), over every journey with work in it. A bar opens its journey.';
const INFO_STATUS = 'Every evidence file by its status. A file can be approved and still lapsed: that is its date, shown in Evidence freshness.';
const INFO_FRESH = 'Files on one scale, counted as the Evidence library counts them. In force: approved and still in date. Expiring: ends within 30 days. Lapsed: past its validity. Waiting: sent for a decision. They overlap (a file in force can be expiring), so they do not add up to the total.';
const INFO_FLOW = 'Evidence files uploaded in each month, and files approved in it, for the last six months (the month so far for this one).';
const INFO_MEASURES = 'Each bar is one measure behind an area of the score, worked out by the server (the share, and the count it is taken from). How each is calculated is in "How is it scored?". A measure with nothing to measure yet shows "No data". Fresh evidence is not shown here: lapsed files are counted from their dates in Evidence freshness.';

export interface ChartsProps {
  scorecard: Feed<Scorecard>;
  journeys: Feed<JourneyListItem[]>;
  evidence: Feed<EvidenceSummaryLite>;
  trend: Feed<TrendPointLite[]>;
  period: string;
  onPeriod: (value: string) => void;
  onOpenAreas: () => void;
}

export function Charts({ scorecard, journeys, evidence, trend, period, onPeriod, onOpenAreas }: ChartsProps) {
  const payload = scorecard.data;
  const target = targetOf(payload?.performance);
  const areas = useMemo(() => areaBars(sectionRows(payload?.sections)), [payload]);
  const groups = useMemo(() => measureGroups(payload?.sections), [payload]);

  const list = journeys.data;
  const rows = useMemo(() => journeyRows(list), [list]);
  const figures = useMemo(() => figuresOf(list), [list]);
  const stages = useMemo(() => stageParts(list), [list]);
  const due = useMemo(() => dueParts(rows), [rows]);
  const activeCount = rows.filter((r) => r.active).length;
  const stack = useMemo(() => requirementStack(figures), [figures]);
  const ready = useMemo(() => readyBars(figures), [figures]);
  const domains = useMemo(() => domainBars(figures), [figures]);

  const series = useMemo(() => trendRows(trend.data), [trend.data]);
  const parts = useMemo(() => evidenceParts(evidence.data), [evidence.data]);
  const fresh = useMemo(() => freshnessBars(evidence.data), [evidence.data]);
  const flow = useMemo(() => evidenceFlow(evidence.data), [evidence.data]);
  const evidenceTotal = evidence.data?.total_count ?? parts.reduce((s, x) => s + x.value, 0);
  const flowHasFiles = flow.some((m) => (m.uploaded ?? 0) > 0 || (m.approved ?? 0) > 0);

  const NO_SCORES = 'Your role cannot read the compliance scores.';
  const NO_JOURNEYS = 'Your role cannot see framework journeys.';
  const NO_EVIDENCE = 'Your role cannot see evidence.';
  const NO_JOURNEY_YET = 'No framework journey has started yet. It appears here once one is started.';
  const NO_FIGURES = 'No journey with work in it has figures yet.';

  return (
    <ChartGrid>
      <Cell span={7}>
        <ChartCard
          id="area-scores" title="Score by area" info={INFO_AREAS} meta={target !== null ? `Target ${target}` : undefined}
          actions={<Button size="sm" aria-haspopup="dialog" onClick={onOpenAreas}>How is it scored?</Button>}
          emptyText="No scored areas yet. They appear here once the platform has data to score." {...shown(scorecard, areas.length > 0, NO_SCORES)}
        >
          <BarList label="Score by area, the weakest first" rows={areas} max={100} nameWidth={150} />
        </ChartCard>
      </Cell>
      <Cell span={5}>
        <ChartCard
          id="journeys" title="Journeys" info={INFO_JOURNEYS} actions={<Button size="sm" href="/frameworks">Open Frameworks</Button>}
          emptyText={NO_JOURNEY_YET} {...shown(journeys, stages.length > 0, NO_JOURNEYS)}
        >
          <p className="m-0 mb-[8px] text-ds-label font-[600] text-ds-fg-muted">By stage</p>
          <SegmentBar label="Journeys by stage" parts={stages} />
          <p className="m-0 mb-[8px] mt-[16px] text-ds-label font-[600] text-ds-fg-muted">By target date</p>
          {activeCount > 0 ? <SegmentBar label="Journeys with work in them, by target date" parts={due} /> : <p className="m-0 text-ds-body text-ds-fg-muted">No journey has work in it.</p>}
        </ChartCard>
      </Cell>

      <Cell span={7}>
        <ChartCard
          id="requirements" title="Requirements by journey" info={INFO_STACK} meta={stack.of > stack.shown ? `${stack.shown} of ${stack.of}` : undefined}
          emptyText={NO_FIGURES} {...shown(journeys, figures.length > 0, NO_JOURNEYS)}
        >
          <StackedBars
            label="Requirements by status, per journey" firstColumn="Journey" nameWidth={150} height={Math.max(200, stack.categories.length * 40 + 40)} categories={stack.categories}
            series={[{ key: 'implemented', label: 'Implemented', color: STATUS.good }, { key: 'inProgress', label: 'In progress', color: STATUS.progress }, { key: 'toStart', label: 'Not started', color: STATUS.neutral }]}
          />
        </ChartCard>
      </Cell>
      <Cell span={5}>
        <ChartCard id="ready" title="Ready by journey" info={INFO_READY} emptyText={NO_FIGURES} {...shown(journeys, ready.length > 0, NO_JOURNEYS)}>
          <BarList label="Ready by journey, the lowest first" rows={ready} max={100} nameWidth={170} />
        </ChartCard>
      </Cell>

      <Cell span={7}>
        <ChartCard
          id="history" title="Implemented and ready over time" info={INFO_TREND}
          actions={<SegmentedControl label="Period" name="compliance-trend-period" value={period} onChange={onPeriod} options={PERIODS.map((x) => ({ value: x.value, label: x.label }))} />}
          emptyText="No history yet. It builds up when a snapshot is captured on a journey." {...shown(trend, series.length > 0, NO_JOURNEYS)}
        >
          <TrendChart
            label="Implemented and ready over time" firstColumn="Day" variant="line" yMax={100} unit="%" height={300} rows={series}
            series={[{ key: 'implemented', label: 'Implemented', color: SERIES[0] }, { key: 'ready', label: 'Ready', color: SERIES[2] }]}
          />
        </ChartCard>
      </Cell>
      <Cell span={5}>
        <ChartCard
          id="open-work" title="Where the open work is" info={INFO_DOMAINS} meta={domains.of > domains.rows.length ? `${domains.rows.length} of ${domains.of}` : undefined}
          emptyText={figures.length > 0 ? 'Nothing is left to do in any domain.' : NO_FIGURES} {...shown(journeys, domains.rows.length > 0, NO_JOURNEYS)}
        >
          <BarList label="Domains with the most open requirements" rows={domains.rows} nameWidth={170} />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="evidence-status" title="Evidence by status" info={INFO_STATUS} actions={<Button size="sm" href="/evidence">Open Evidence</Button>}
          emptyText="No evidence yet. Files appear here once they are uploaded." {...shown(evidence, parts.length > 0, NO_EVIDENCE)}
        >
          <DonutChart label="Evidence by status" slices={parts} centre={{ value: formatCount(evidenceTotal), caption: 'files' }} noun="files" size={132} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard id="evidence-fresh" title="Evidence freshness" info={INFO_FRESH} emptyText="Nothing to show until evidence is uploaded." {...shown(evidence, fresh.rows.length > 0 && evidenceTotal > 0, NO_EVIDENCE)}>
          <BarList label="Evidence by freshness, counts" rows={fresh.rows} max={fresh.max} nameWidth={140} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard id="evidence-flow" title="Uploaded and approved" meta="Last 6 months" info={INFO_FLOW} emptyText="No evidence was uploaded in the last six months." {...shown(evidence, flowHasFiles, NO_EVIDENCE)}>
          <TrendChart
            label="Evidence uploaded and approved by month" firstColumn="Month" variant="bars" height={190} rows={flow}
            series={[{ key: 'uploaded', label: 'Uploaded', color: SERIES[0] }, { key: 'approved', label: 'Approved', color: SERIES[2] }]}
          />
        </ChartCard>
      </Cell>

      <Cell span={12}>
        <ChartCard id="measures" title="Measures behind the score" info={INFO_MEASURES} emptyText="No measures yet. They appear here once the platform has data to score." {...shown(scorecard, groups.length > 0, NO_SCORES)}>
          <div className="grid gap-x-[40px] gap-y-[24px] md:grid-cols-2">
            {groups.map((g) => (
              <section key={g.key} aria-label={`${g.label}: the measures behind its score`} className="min-w-0">
                <div className="mb-[8px] flex items-center gap-[8px]">
                  <h3 className="m-0 min-w-0 flex-1 truncate !text-ds-body !font-[600] !text-ds-fg">
                    <Link href={g.href} className={`rounded-ds-control hover:underline ${FOCUS}`}>{g.label}</Link>
                  </h3>
                  <span className="tabular-nums text-ds-body text-ds-fg">{g.score === null ? '—' : Math.round(g.score)}</span>
                  <StatusPill size="sm" tone={areaBand.tone(g.word)} label={areaBand.label(g.word)} />
                </div>
                {g.rows.length > 0 ? <BarList label={`${g.label}, measures`} rows={g.rows} max={100} nameWidth={190} /> : <p className="m-0 text-ds-body text-ds-fg-muted">Nothing is measured here yet.</p>}
              </section>
            ))}
          </div>
        </ChartCard>
      </Cell>
    </ChartGrid>
  );
}

