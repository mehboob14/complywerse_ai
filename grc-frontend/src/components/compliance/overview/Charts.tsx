'use client';

/**
 * The graphs of the Compliance Overview, seven cards on the kit's 12-column grid (components/overview/charts), in the order posture -> how it moves: the score by area and the frameworks as small
 * multiples (AreaTiles: a ring and a figure per area, in the colour and the word of its status, each opening its module), the requirements and the evidence by status (donuts), the evidence freshness and
 * the three measures that say where the controls stand (bars), and the daily record of Implemented and Ready. Every card is drawn from an answer the page already has (graphModel.ts says how), loads,
 * fails (with Retry) and has nothing on its own, and a failed or refused request is never a chart of zeros. Every card's title has an "Open" link, and every tile, bar, slice and legend row that opens
 * records is a link to the module page already filtered to it where the module can filter. A percentage here is one the platform already defines (the server's scores and measures, the journey model's
 * Ready and Implemented); the cards that show counts show counts, and each card says what it counts in its (i).
 */
import { useMemo } from 'react';
import { AreaTiles, BarList, Cell, ChartCard, ChartGrid, DonutChart, TrendChart, SERIES, type ChartCardProps } from '@/components/overview/charts';
import { Button, SegmentedControl } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import {
  AREA_WORDS, FRAMEWORK_WORDS, PERIODS, areaNotes, areaTiles, controlBars, evidenceParts, feedState, figuresOf, freshnessBars, frameworkTiles, requirementParts, trendRows, type TrendPointLite,
} from './graphModel';
import type { Scorecard } from './overviewData';
import { journeyRows, sectionRows, type EvidenceSummaryLite, type JourneyListItem } from './overviewModel';
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

const INFO_AREAS = 'The six areas of the compliance score, worked out by the server (80 and over is strong, 60 and over fair, below that weak; the score is the weighted mean of the six, target 85). The weakest come first; a tile opens the page that area is worked on. Hover a tile for its weight and what is wrong in it.';
const INFO_FRAMEWORKS = 'Every framework journey with the share of its requirements that have approved evidence (Ready): 75 and over is strong, 50 and over building, below that early. The most urgent first (a target date that has passed, then the lowest Ready). A tile opens the journey; hover it for Implemented and the stage.';
const INFO_REQUIREMENTS = 'The requirements of every journey with work in it, by where they stand: implemented (the verified ones counted once), in progress, not started. Requirements put out of scope are left out. Counts, not shares.';
const INFO_STATUS = 'Every evidence file by its status. A file can be approved and still lapsed: that is its date, shown in Evidence freshness. A part opens the library at that status.';
const INFO_FRESH = 'Files on one scale, counted as the Evidence library counts them. In date: approved and still in date. Expiring: ends within 30 days. Lapsed: past its validity. Waiting: sent for a decision. They overlap (a file in date can be expiring), so they do not add up to the total.';
const INFO_CONTROLS = 'Where the controls stand, each the server\'s own score of a measure: the share of controls with approved evidence, the share independently verified, and the share of active controls tested. 80 and over is strong, 60 and over fair, below that weak. How each is calculated is in "How is it scored?".';
const INFO_TREND = 'The platform\'s daily record of Implemented and Ready, controls-weighted over every journey that has a snapshot. It grows when a snapshot is captured on a journey; a day without one is not drawn.';

const NO_SCORES = 'Your role cannot read the compliance scores.';
const NO_JOURNEYS = 'Your role cannot see framework journeys.';
const NO_EVIDENCE = 'Your role cannot see evidence.';

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
  const areas = useMemo(() => areaTiles(sectionRows(payload?.sections), areaNotes(payload?.attention_queue, evidence.data)), [payload, evidence.data]);
  const controls = useMemo(() => controlBars(payload?.sections), [payload]);

  const list = journeys.data;
  const rows = useMemo(() => journeyRows(list), [list]);
  const tiles = useMemo(() => frameworkTiles(rows), [rows]);
  const parts = useMemo(() => requirementParts(figuresOf(list)), [list]);
  const requirementTotal = parts.reduce((s, x) => s + x.value, 0);

  const series = useMemo(() => trendRows(trend.data), [trend.data]);
  const status = useMemo(() => evidenceParts(evidence.data), [evidence.data]);
  const fresh = useMemo(() => freshnessBars(evidence.data), [evidence.data]);
  const evidenceTotal = evidence.data?.total_count ?? status.reduce((s, x) => s + x.value, 0);

  return (
    <ChartGrid>
      <Cell span={5}>
        <ChartCard
          id="area-scores" title="Score by area" loadingHeight={172} info={INFO_AREAS} actions={<Button size="sm" aria-haspopup="dialog" onClick={onOpenAreas}>How is it scored?</Button>}
          emptyText="No scored areas yet. They appear here once the platform has data to score." {...shown(scorecard, areas.length > 0, NO_SCORES)}
        >
          <AreaTiles label="Score by area, the weakest first" items={areas} words={AREA_WORDS} />
        </ChartCard>
      </Cell>
      <Cell span={7}>
        <ChartCard
          id="frameworks" title="Frameworks" loadingHeight={112} info={INFO_FRAMEWORKS} href="/frameworks" hrefLabel="Open Frameworks"
          actions={<Button size="sm" variant="link" href="/frameworks/onboarding">Onboarding</Button>}
          emptyText="No framework journey has started yet. Start one from Onboarding." {...shown(journeys, tiles.length > 0, NO_JOURNEYS)}
        >
          <AreaTiles label="Frameworks by Ready, the most urgent first" items={tiles} max={8} moreHref="/frameworks" words={FRAMEWORK_WORDS} />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="requirements" title="Requirements" loadingHeight={132} info={INFO_REQUIREMENTS} href="/frameworks" hrefLabel="Open Frameworks"
          emptyText={tiles.length > 0 ? 'No journey with work in it has figures yet.' : 'No framework journey has started yet.'} {...shown(journeys, parts.length > 0, NO_JOURNEYS)}
        >
          <DonutChart label="Requirements by status" slices={parts} centre={{ value: formatCount(requirementTotal), caption: 'in scope' }} noun="requirements" size={132} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="evidence-status" title="Evidence" loadingHeight={132} info={INFO_STATUS} href="/evidence" hrefLabel="Open Evidence"
          emptyText="No evidence yet. Files appear here once they are uploaded." {...shown(evidence, status.length > 0, NO_EVIDENCE)}
        >
          <DonutChart label="Evidence by status" slices={status} centre={{ value: formatCount(evidenceTotal), caption: 'files' }} noun="files" size={132} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="evidence-fresh" title="Freshness" loadingHeight={132} info={INFO_FRESH} href="/evidence" hrefLabel="Open Evidence"
          emptyText="Nothing to show until evidence is uploaded." {...shown(evidence, fresh.rows.length > 0 && evidenceTotal > 0, NO_EVIDENCE)}
        >
          <BarList label="Evidence by freshness, counts" rows={fresh.rows} max={fresh.max} nameWidth={150} />
        </ChartCard>
      </Cell>

      <Cell span={8}>
        <ChartCard
          id="history" title="Implemented and ready" loadingHeight={224} info={INFO_TREND} href="/frameworks" hrefLabel="Open Frameworks"
          actions={<SegmentedControl label="Period" name="compliance-trend-period" value={period} onChange={onPeriod} options={PERIODS.map((x) => ({ value: x.value, label: x.label }))} />}
          emptyText="No history yet. It builds up when a snapshot is captured on a journey." {...shown(trend, series.length > 0, NO_JOURNEYS)}
        >
          <TrendChart
            label="Implemented and ready over time" firstColumn="Day" variant="line" yMax={100} unit="%" height={224} rows={series}
            series={[{ key: 'implemented', label: 'Implemented', color: SERIES[0] }, { key: 'ready', label: 'Ready', color: SERIES[2] }]}
          />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="controls" title="Controls" loadingHeight={100} info={INFO_CONTROLS} href="/controls" hrefLabel="Open Controls"
          emptyText="No control measures yet. They appear here once controls are added." {...shown(scorecard, controls.length > 0, NO_SCORES)}
        >
          <BarList label="Controls: with evidence, verified and tested" rows={controls} max={100} nameWidth={110} />
        </ChartCard>
      </Cell>
    </ChartGrid>
  );
}
