'use client';

/**
 * The figures the Compliance Overview leads with: six tiles in a row (the kit's KpiTile), each with what it counts one (i) away. The score is the server's (rounded, with the grade it gave and the target
 * it scored against); Ready and Implemented are the journey model's over the journeys with work in them, with the platform's daily record as their shape and "up N points" between the last two
 * snapshots; open requirements and journeys due come from the same list; evidence approved is this month's count from the evidence summary, with six months as its shape. A request that failed or
 * has not answered is a state of the tile (loading, failed with Retry, "No access"), never a 0; a figure the answer did not carry is "Not recorded". The rules and the series: graphModel.ts.
 */
import { useMemo } from 'react';
import { KpiRow, KpiTile, trendText } from '@/components/overview/charts';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatPercent } from '@/lib/format';
import { portfolioNumbers } from '@/lib/journeyModel';
import {
  ATTENTION_HREF, approvedThisMonth, dueCounts, evidenceFlow, feedState, figuresOf, openWork, scoreTone, sparkOf, trendRows, type TrendPointLite,
} from './graphModel';
import type { Scorecard } from './overviewData';
import { GRADE_LABEL, GRADE_TONE, journeyRows, postureOf, targetOf, type EvidenceSummaryLite, type JourneyListItem } from './overviewModel';

/** A request as a tile or card sees it (a React Query result fits). */
export interface Feed<T> { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

/** A tile's "failed" state: only when there is no earlier answer to show; Retry only where asking again can help. */
export function failureOf(q: Feed<unknown>, title: string): { title: string; message: string; onRetry?: () => void } | null {
  if (!q.isError || q.data !== undefined) return null;
  return { title, message: errorMessage(q.error), onRetry: canRetry(q.error) ? () => { void q.refetch(); } : undefined };
}

export const refusedBy = (q: Feed<unknown>): boolean => feedState(q, true) === 'denied';

const INFO_SCORE = 'The weighted mean of six areas (frameworks, controls, control effectiveness, evidence, control library, regulatory), worked out by the server. The grade is 85 and over excellent, 70 good, 50 fair, below that poor.';
const INFO_READY = 'Requirements whose approved evidence meets what they ask for, out of the requirements in scope, over every journey with work in it. A file nobody has approved does not count. The line is the platform\'s daily record over every journey; it grows when a snapshot is captured on a journey.';
const INFO_IMPLEMENTED = 'Requirements marked implemented or verified (counted once), out of the requirements in scope, over every journey with work in it. The line is the platform\'s daily record over every journey.';
const INFO_OPEN = 'Requirements in scope that are not yet implemented: not started plus in progress, over every journey with work in it.';
const INFO_DUE = 'Journeys with work in them whose target date is within 30 days or has passed.';
const INFO_EVIDENCE = 'Evidence files approved so far this month, and the six months before it as the line (the same count as the Evidence library).';

export interface TilesProps {
  scorecard: Feed<Scorecard>;
  journeys: Feed<JourneyListItem[]>;
  evidence: Feed<EvidenceSummaryLite>;
  trend: Feed<TrendPointLite[]>;
}

export function Tiles({ scorecard, journeys, evidence, trend }: TilesProps) {
  const posture = postureOf(scorecard.data?.performance);
  const target = targetOf(scorecard.data?.performance);

  const list = journeys.data;
  const p = useMemo(() => portfolioNumbers(list ?? [], { activeOnly: true }), [list]);
  const figures = useMemo(() => figuresOf(list), [list]);
  const work = useMemo(() => openWork(figures), [figures]);
  const due = useMemo(() => dueCounts(journeyRows(list)), [list]);
  const series = useMemo(() => trendRows(trend.data), [trend.data]);
  const readySpark = sparkOf(series, 'ready', 'Ready');
  const implSpark = sparkOf(series, 'implemented', 'Implemented');
  const known = journeys.data !== undefined && p.journeys > 0;
  const jFail = failureOf(journeys, "Couldn't load the framework journeys");
  const jBusy = journeys.isPending;
  const sinceSnapshot = 'since the last snapshot';

  const flow = useMemo(() => evidenceFlow(evidence.data), [evidence.data]);
  const approved = useMemo(() => approvedThisMonth(evidence.data), [evidence.data]);
  const approvedSummary = trendText('Evidence approved', flow.map((f) => ({ label: f.label, value: f.approved })));

  return (
    <KpiRow>
      <KpiTile
        label="Compliance score" value={posture.score === null ? null : String(posture.score)} unit={posture.score === null ? undefined : '/ 100'} tone={scoreTone(posture.grade ? GRADE_TONE[posture.grade] : null)}
        progress={posture.score} note={posture.grade ? `${GRADE_LABEL[posture.grade]}${target !== null ? ` · target ${target}` : ''}` : undefined} info={INFO_SCORE}
        loading={scorecard.isPending} denied={refusedBy(scorecard)} error={refusedBy(scorecard) ? null : failureOf(scorecard, "Couldn't load the compliance score")}
      />
      <KpiTile
        label="Ready" value={known ? formatPercent(p.readyPct) : null} progress={known ? p.readyPct : null}
        note={known ? `${formatCount(p.approved)} of ${formatCount(p.applicable)} requirements${p.missing > 0 ? ` · ${formatCount(p.missing)} journeys not counted` : ''}` : undefined}
        delta={readySpark?.delta ? { ...readySpark.delta, since: sinceSnapshot } : null}
        spark={readySpark ? { values: readySpark.values, label: 'Ready over time', summary: readySpark.summary, floor: 0 } : null}
        info={INFO_READY} loading={jBusy} error={jFail}
      />
      <KpiTile
        label="Implemented" value={known ? formatPercent(p.implementedPct) : null} progress={known ? p.implementedPct : null}
        note={known ? `${formatCount(p.implemented)} of ${formatCount(p.applicable)} requirements` : undefined}
        delta={implSpark?.delta ? { ...implSpark.delta, since: sinceSnapshot } : null}
        spark={implSpark ? { values: implSpark.values, label: 'Implemented over time', summary: implSpark.summary, floor: 0 } : null}
        info={INFO_IMPLEMENTED} loading={jBusy} error={jFail}
      />
      <KpiTile
        label="Open requirements" value={figures.length > 0 ? formatCount(work.open) : null} href={figures.length > 0 ? '/frameworks' : undefined} linkLabel={`${work.open} open requirements. Open Frameworks`}
        note={figures.length > 0 ? `${formatCount(work.toStart)} not started · ${formatCount(work.inProgress)} in progress` : undefined} info={INFO_OPEN} loading={jBusy} error={jFail}
      />
      <KpiTile
        label="Journeys due" value={list !== undefined ? formatCount(due.due) : null} unit={list !== undefined ? (due.due === 1 ? 'journey' : 'journeys') : undefined}
        tone={due.overdue > 0 ? 'danger' : due.due > 0 ? 'warning' : 'default'} note={list !== undefined ? (due.overdue > 0 ? `${formatCount(due.overdue)} overdue` : 'None overdue') : undefined}
        href={due.due > 0 ? ATTENTION_HREF : undefined} linkLabel={`${due.due} journeys due. Show the ones that need attention`} info={INFO_DUE} loading={jBusy} error={jFail}
      />
      <KpiTile
        label="Evidence approved" value={approved ? formatCount(approved.value) : null}
        note={approved ? `${approved.label} so far${approved.previous !== null ? ` · ${formatCount(approved.previous)} last month` : ''}` : undefined}
        spark={approved && flow.length >= 2 ? { values: approved.values, label: 'Evidence approved, last six months', summary: approvedSummary, floor: 0 } : null}
        href={approved ? '/evidence' : undefined} linkLabel={approved ? `${approved.value} evidence files approved this month. Open Evidence` : undefined}
        info={INFO_EVIDENCE} loading={evidence.isPending} denied={refusedBy(evidence)} error={refusedBy(evidence) ? null : failureOf(evidence, "Couldn't load evidence")}
      />
    </KpiRow>
  );
}
