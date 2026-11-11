'use client';

/**
 * The figures and graphs of the Assessments Overview, on the chart kit (components/overview/charts): four tiles (the server's score with its grade, the remediation SLA score, how many assessments
 * the board scores, the gaps still open and how many are overdue), then the score by category, the assessments by score (the lowest first, each opening its workspace) and the gaps by state. Every
 * figure is the board's (`GET /overview`, the request the page already makes); a score that is not recorded says so and is never a 0, a failed request is a state of the card with Retry, never a
 * chart of zeros. Rules and series: visualModel.ts.
 */
import { useMemo } from 'react';
import { BarList, Cell, ChartCard, ChartGrid, KpiRow, KpiTile, SegmentBar } from '@/components/overview/charts';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { grade } from '@/lib/statuses/assessments';
import { gradeOf } from '@/components/assessments/workspace/workspaceModel';
import type { Board } from '../_data/types';
import type { Load } from './OverviewParts';
import { TARGET, postureOf } from './overviewModel';
import { assessmentBars, categoryBars, gapParts, gradeTone } from './visualModel';

const INFO_SCORE = 'The average of every assessment\'s content score, weighted by how many controls each has, worked out by the server. 85 and over is excellent, 70 good, 50 fair, below 50 poor.';
const INFO_SLA = 'How well gaps are closed against their dates, worked out by the server from your organization\'s SLA days.';
const INFO_CATEGORIES = 'The average content score of each group of assessments, as the server groups them, the weakest first. A bar opens the assessments of that group.';
const INFO_ASSESSMENTS = 'Every assessment the board scores, the lowest content score first. A bar opens the assessment. One with nothing answered yet has no score.';
const INFO_GAPS = 'Gaps are the controls that are not complied with or that have a fix under way. Open gaps include the overdue ones, so within target is open minus overdue.';

const failureOf = (load: Load) => (load.error ? { title: "Couldn't load the overview", message: errorMessage(load.error), onRetry: canRetry(load.error) ? load.retry : undefined } : null);

/** The four tiles the page leads with. */
export function Tiles({ board, load }: { board: Board | undefined; load: Load }) {
  const p = board ? postureOf(board) : null;
  const failure = failureOf(load);
  const scored = p !== null && p.assessments > 0;
  return (
      <KpiRow>
        <KpiTile
          label="Score" value={scored && p.score != null ? String(Math.round(p.score)) : null} unit={scored && p.score != null ? '/ 100' : undefined} tone={gradeTone(p?.grade ?? null)}
          progress={scored ? p.score : null} note={scored && p.score != null && p.grade ? `${grade.label(p.grade)} · target ${TARGET}` : undefined} info={INFO_SCORE} loading={load.loading} error={failure}
        />
        <KpiTile
          label="Remediation SLA" value={board && p && p.sla != null ? String(Math.round(p.sla)) : null} unit={p && p.sla != null ? '/ 100' : undefined} tone={gradeTone(gradeOf(p?.sla ?? null))}
          progress={p?.sla ?? null} note={board && p && p.sla == null ? 'No gap to remediate yet' : p && p.sla != null ? (grade.label(gradeOf(p.sla)) as string) : undefined} info={INFO_SLA} loading={load.loading} error={failure}
        />
        <KpiTile label="Assessments" value={p ? formatCount(p.assessments) : null} href={p && p.assessments > 0 ? '/assessments/register' : undefined} linkLabel="Open all assessments" info="Assessments the board scores." loading={load.loading} error={failure} />
        <KpiTile
          label="Open gaps" value={board ? formatCount(board.sla.open) : null} tone={board && board.sla.overdue > 0 ? 'danger' : 'default'}
          note={board ? `${formatCount(board.sla.overdue)} overdue · ${formatCount(board.sla.closed)} closed` : undefined} href={board && board.sla.overdue > 0 ? '/assessments/register?quick=overdue' : undefined}
          linkLabel={board ? `${board.sla.open} open gaps, ${board.sla.overdue} overdue. Open the assessments with gaps past their date` : undefined} info={INFO_GAPS} loading={load.loading} error={failure}
        />
      </KpiRow>
  );
}

/** The three graphs under the counters. */
export function Charts({ board, load }: { board: Board | undefined; load: Load }) {
  const categories = useMemo(() => categoryBars(board), [board]);
  const assessments = useMemo(() => assessmentBars(board), [board]);
  const gaps = useMemo(() => gapParts(board), [board]);
  const failure = failureOf(load);
  const state = (hasContent: boolean) => (load.loading ? 'loading' : load.error ? 'error' : hasContent ? 'ready' : 'empty') as 'loading' | 'error' | 'ready' | 'empty';
  const err = failure ? { message: failure.message, onRetry: failure.onRetry } : null;
  return (
      <ChartGrid>
        <Cell span={5}>
          <ChartCard id="by-category" title="Score by category" info={INFO_CATEGORIES} emptyText="No assessment is scored yet. A score appears once controls are answered." state={state(categories.length > 0)} error={err}>
            <BarList label="Score by category, the weakest first" rows={categories} max={100} nameWidth={150} />
          </ChartCard>
        </Cell>
        <Cell span={7}>
          <ChartCard
            id="by-assessment" title="Assessments by score" info={INFO_ASSESSMENTS} meta={assessments.of > assessments.rows.length ? `${assessments.rows.length} of ${assessments.of}` : undefined}
            emptyText="No assessment is scored yet. A score appears once controls are answered." state={state(assessments.rows.length > 0)} error={err}
          >
            <BarList label="Assessments by score, the lowest first" rows={assessments.rows} max={100} nameWidth={170} />
          </ChartCard>
        </Cell>
        <Cell span={12}>
          <ChartCard id="gap-states" title="Gaps by state" info={INFO_GAPS} emptyText="There is no gap to remediate yet." state={state(gaps.length > 0)} error={err}>
            <SegmentBar label="Gaps by state" parts={gaps} height={20} noun="gaps" />
          </ChartCard>
        </Cell>
      </ChartGrid>
  );
}
