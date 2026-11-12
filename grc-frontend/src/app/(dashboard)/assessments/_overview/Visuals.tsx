'use client';

/**
 * The figures and graphs of the Assessments Overview, on the chart kit (components/overview/charts): four tiles (the server's score with its grade, the remediation SLA score, how many assessments the board
 * scores, the gaps still open and how many are overdue), then four cards: the score by category as small multiples, the assessments by grade (a donut), the five lowest assessments (bars) and the gaps by state
 * and by due date. Every tile, card title, tile of a category, slice and bar opens the register (or the assessment) already filtered to it. Every figure is the board's (`GET /overview`, the request the page
 * already makes) or the gaps' dates (`GET /points`); a score that is not recorded says so and is never a 0, a failed request is a state of the card with Retry, never a chart of zeros. Rules and series: visualModel.ts.
 */
import { useMemo } from 'react';
import { AreaTiles, BarList, Cell, ChartCard, ChartGrid, DonutChart, KpiRow, KpiTile } from '@/components/overview/charts';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { grade } from '@/lib/statuses/assessments';
import { gradeOf } from '@/components/assessments/workspace/workspaceModel';
import type { Board, Point, Policy } from '../_data/types';
import { GapsActions, GapsBody, type Load } from './OverviewParts';
import { TARGET, postureOf } from './overviewModel';
import { GRADE_WORDS, categoryTiles, gapParts, gradeParts, gradeTone, lowestBars } from './visualModel';

const REGISTER = '/assessments/register';

const INFO_SCORE = 'The average of every assessment\'s content score, weighted by how many controls each has, worked out by the server. 85 and over is excellent, 70 good, 50 fair, below 50 poor. The tile opens the assessments, the lowest score first.';
const INFO_SLA = 'How well gaps are closed against their dates, worked out by the server from your organization\'s SLA days. The tile opens the assessments with the most overdue gaps first.';
const INFO_COUNT = 'Assessments the board scores.';
const INFO_GAPS = 'Gaps are the controls that are not complied with or that have a fix under way. Open gaps include the overdue ones, so within target is open minus overdue. The tile opens the assessments with gaps past their date.';
const INFO_CATEGORIES = 'The average content score of each group of assessments, as the server groups them, the weakest first. The colour is the grade: 85 and over excellent, 70 good (both drawn as "good or better"), 50 fair, below 50 poor. A tile opens the assessments of that group; hover it for its grade, its number of assessments and its SLA score.';
const INFO_GRADES = 'Every assessment the board scores, by the grade of its content score (excellent and good are one colour). A part opens the assessments of that grade; "Nothing answered" is the ones with no score yet.';
const INFO_LOWEST = 'The five assessments with the lowest content score (one with nothing answered yet has no score and comes last). A bar opens the assessment; the card\'s Open link opens all of them, the lowest first.';
const INFO_GAP_STATES = 'The gaps by where they stand (closed, open within their date, overdue), and under it the open gaps by how far off their date is, from your organization\'s SLA days. Pick a day after today to see how many would be past their date if nothing is closed before it. The types that count their gaps another way (maturity scores, registers) are in the first bar, not the second.';

const failureOf = (load: Load) => (load.error ? { title: "Couldn't load the overview", message: errorMessage(load.error), onRetry: canRetry(load.error) ? load.retry : undefined } : null);

/** The four tiles the page leads with. */
export function Tiles({ board, load }: { board: Board | undefined; load: Load }) {
  const p = board ? postureOf(board) : null;
  const failure = failureOf(load);
  const scored = p !== null && p.assessments > 0;
  const scoredNumber = scored && p.score != null;
  return (
    <KpiRow>
      <KpiTile
        label="Score" value={scoredNumber ? String(Math.round(p.score as number)) : null} unit={scoredNumber ? '/ 100' : undefined} tone={gradeTone(p?.grade ?? null)}
        progress={scored ? p.score : null} note={scoredNumber && p.grade ? `${grade.label(p.grade)} · target ${TARGET}` : undefined}
        href={scoredNumber ? `${REGISTER}?sort=score:asc` : undefined} linkLabel={scoredNumber ? `Score ${Math.round(p.score as number)}. Open the assessments, the lowest score first` : undefined}
        info={INFO_SCORE} loading={load.loading} error={failure}
      />
      <KpiTile
        label="Remediation SLA" value={board && p && p.sla != null ? String(Math.round(p.sla)) : null} unit={p && p.sla != null ? '/ 100' : undefined} tone={gradeTone(gradeOf(p?.sla ?? null))}
        progress={p?.sla ?? null} note={board && p && p.sla == null ? 'No gap to remediate yet' : p && p.sla != null ? (grade.label(gradeOf(p.sla)) as string) : undefined}
        href={board && p && p.sla != null ? `${REGISTER}?sort=overdue:desc` : undefined} linkLabel={p && p.sla != null ? `Remediation SLA ${Math.round(p.sla)}. Open the assessments by overdue gaps` : undefined}
        info={INFO_SLA} loading={load.loading} error={failure}
      />
      <KpiTile label="Assessments" value={p ? formatCount(p.assessments) : null} href={p && p.assessments > 0 ? REGISTER : undefined} linkLabel="Open all assessments" info={INFO_COUNT} loading={load.loading} error={failure} />
      <KpiTile
        label="Open gaps" value={board ? formatCount(board.sla.open) : null} tone={board && board.sla.overdue > 0 ? 'danger' : 'default'}
        note={board && board.sla.overdue > 0 ? `${formatCount(board.sla.overdue)} overdue` : undefined}
        href={board ? (board.sla.overdue > 0 ? `${REGISTER}?quick=overdue` : `${REGISTER}?sort=gaps:desc`) : undefined}
        linkLabel={board ? `${board.sla.open} open gaps, ${board.sla.overdue} overdue. Open the assessments ${board.sla.overdue > 0 ? 'with gaps past their date' : 'by open gaps'}` : undefined}
        info={INFO_GAPS} loading={load.loading} error={failure}
      />
    </KpiRow>
  );
}

export interface ChartsProps {
  board: Board | undefined;
  load: Load;
  points: readonly Point[] | undefined;
  pointsLoad: Load;
  policy: Policy | undefined;
  canTune: boolean;
  /** the "what if" day, from the address ('' = today) */
  asof: string;
  onAsof: (day: string) => void;
}

/** The four cards under the tiles. */
export function Charts({ board, load, points, pointsLoad, policy, canTune, asof, onAsof }: ChartsProps) {
  const categories = useMemo(() => categoryTiles(board), [board]);
  const grades = useMemo(() => gradeParts(board), [board]);
  const lowest = useMemo(() => lowestBars(board), [board]);
  const gaps = useMemo(() => gapParts(board), [board]);
  const failure = failureOf(load);
  const state = (hasContent: boolean) => (load.loading ? 'loading' : load.error ? 'error' : hasContent ? 'ready' : 'empty') as 'loading' | 'error' | 'ready' | 'empty';
  const err = failure ? { message: failure.message, onRetry: failure.onRetry } : null;
  const NOT_SCORED = 'No assessment is scored yet. A score appears once controls are answered.';
  const gradeTotal = grades.reduce((n, g) => n + g.value, 0);
  return (
    <ChartGrid>
      <Cell span={7}>
        <ChartCard id="by-category" title="Score by category" loadingHeight={112} info={INFO_CATEGORIES} href={REGISTER} hrefLabel="Open all assessments" emptyText={NOT_SCORED} state={state(categories.length > 0)} error={err}>
          <AreaTiles label="Score by category, the weakest first" items={categories} words={GRADE_WORDS} />
        </ChartCard>
      </Cell>
      <Cell span={5}>
        <ChartCard id="by-grade" title="By grade" loadingHeight={132} info={INFO_GRADES} href={REGISTER} hrefLabel="Open all assessments" emptyText={NOT_SCORED} state={state(grades.length > 0)} error={err}>
          <DonutChart label="Assessments by grade" slices={grades} centre={{ value: formatCount(gradeTotal), caption: 'scored' }} noun="assessments" size={132} />
        </ChartCard>
      </Cell>
      <Cell span={6}>
        <ChartCard
          id="lowest" title="Lowest scores" loadingHeight={150} info={INFO_LOWEST} meta={lowest.of > lowest.rows.length ? `${lowest.rows.length} of ${lowest.of}` : undefined}
          href={`${REGISTER}?sort=score:asc`} hrefLabel="Open all assessments, the lowest score first" emptyText={NOT_SCORED} state={state(lowest.rows.length > 0)} error={err}
        >
          <BarList label="Lowest scoring assessments" rows={lowest.rows} max={100} nameWidth={170} />
        </ChartCard>
      </Cell>
      <Cell span={6}>
        <ChartCard
          id="gaps" title="Gaps" loadingHeight={110} info={INFO_GAP_STATES} href={`${REGISTER}?sort=gaps:desc`} hrefLabel="Open the assessments by open gaps"
          actions={<GapsActions asof={asof} onAsof={onAsof} canTune={canTune} policy={policy} />}
          emptyText="There is no gap to remediate yet." state={state(gaps.length > 0)} error={err}
        >
          <GapsBody board={board} points={points} policy={policy} pointsLoad={pointsLoad} asof={asof} canTune={canTune} />
        </ChartCard>
      </Cell>
    </ChartGrid>
  );
}
