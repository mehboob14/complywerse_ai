'use client';

/**
 * The parts of the Assessments Overview the cockpit frame (components/overview) arranges: "Do now" (the signed-in person's own controls, drafts to scope and evidence to decide, one action on
 * each row), the posture card (the server's score with its grade, the SLA score), and the remediation clock of every assessment the board counts. Every figure is the
 * server's; each part loads, fails (with Retry) and is empty on its own, and a figure that is not recorded says so and is never 0. Rows and words: overviewModel.ts.
 */
import { useState, type ReactNode } from 'react';
import { CheckCircle2, Clock, SlidersHorizontal } from 'lucide-react';
import { Button, EmptyState, ErrorState, Notice, ProgressBar, SectionCard, SkeletonRows, StatTile, StatusPill, TextInput, WorkRow } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { EMPTY, formatCount, formatDate } from '@/lib/format';
import { statusPill, TONE } from '@/lib/status';
import { grade } from '@/lib/statuses/assessments';
import { barShares } from '@/components/assessments/workspace/clockModel';
import type { Board, Point, Policy } from '../_data/types';
import { SlaDialog } from './SlaDialog';
import { TARGET, daysOf, mineLine, portfolioClock, postureOf, whatIfBounds, whatIfMs, type WorkRowModel } from './overviewModel';

const MUTED = 'text-ds-fg-muted';

export interface Load { loading: boolean; error: unknown; retry: () => void }
const errorOf = (title: string, load: Load) => <ErrorState compact title={title} message={errorMessage(load.error)} onRetry={canRetry(load.error) ? load.retry : undefined} />;

// ── Do now ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function DoNowCard({ rows, total, limit, load }: { rows: WorkRowModel[]; total: number | null; limit: number; load: Load }) {
  const shown = rows.slice(0, limit);
  return (
    <SectionCard
      id="work"
      title="Do now"
      info="Your own work, the most urgent first: controls assigned to you (or to a department you belong to) that are open, evidence waiting for your decision, and drafts you own that still need their scope."
      meta={total !== null && !load.error ? mineLine(shown.length, total) : undefined}
    >
      {load.loading ? <SkeletonRows rows={4} columns={3} label="Loading your work" />
        : load.error ? errorOf("Couldn't load your work", load)
        : total === 0 ? (
          <p className={`flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body ${MUTED}`}>
            <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
            {"You're all caught up. Controls assigned to you, drafts to scope and evidence to decide appear here."}
          </p>
        ) : (
          <>
            <ul aria-label="Do now" className="m-0 list-none p-0">
              {shown.map((r) => (
                <li key={r.key} className="border-t border-ds-border first:border-t-0">
                  <WorkRow as="div" kind={r.kind} title={r.title} href={r.href} context={r.context || undefined} due={r.due ?? undefined} calendar overdue={r.due ? undefined : false} action={{ label: r.action, href: r.href }} />
                </li>
              ))}
            </ul>
            {total !== null && total > shown.length && (
              <div className={`mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label ${MUTED}`}>
                <span role="status">{mineLine(shown.length, total)}</span>
                <Button size="sm" variant="link" href="/assessments/register?quick=waiting">All assessments waiting for me</Button>
              </div>
            )}
          </>
        )}
    </SectionCard>
  );
}

// ── Posture ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function PostureCard({ board, load }: { board: Board | undefined; load: Load }) {
  const p = board ? postureOf(board) : null;
  return (
    <SectionCard
      id="posture"
      title="Posture"
      info="The score is the average of every assessment's content score, weighted by how many controls each has. The SLA score is how well gaps are closed against their dates. 85 and over is excellent, 70 good, 50 fair, below 50 poor."
    >
      {load.loading ? <SkeletonRows rows={3} columns={2} label="Loading the posture" />
        : load.error || !p ? errorOf("Couldn't load the posture", load)
        : p.assessments === 0 ? <p className={`m-0 text-ds-body ${MUTED}`}>No assessment is scored yet. A score appears once controls are answered.</p>
        : (
          <div className="flex flex-col gap-[16px]">
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-[8px] gap-y-[4px]">
                <span className="text-ds-body text-ds-fg-body">Score</span>
                <span className="inline-flex items-center gap-[8px]">
                  <span className="text-[28px] font-[600] leading-none tabular-nums text-ds-fg" title={p.score != null ? `Score ${p.score}` : undefined}>{p.score != null ? Math.round(p.score) : EMPTY}</span>
                  {p.grade && <StatusPill size="sm" {...statusPill(grade, p.grade)} />}
                </span>
              </div>
              <div className="mt-[6px]"><ProgressBar value={p.score} label="Score" showValue={false} /></div>
              <p className={`mt-[4px] text-ds-label ${MUTED}`}>
                {p.score == null ? 'Nothing is answered yet.' : p.toTarget == null ? `Target ${TARGET} reached.` : `${p.toTarget} points to the target of ${TARGET}.`}
                {` Across ${formatCount(p.assessments)} ${p.assessments === 1 ? 'assessment' : 'assessments'}.`}
              </p>
            </div>
            <div className="border-t border-ds-border pt-[12px]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-[8px] gap-y-[4px]">
                <span className="text-ds-body text-ds-fg-body">Remediation SLA</span>
                <span className="text-[28px] font-[600] leading-none tabular-nums text-ds-fg">{p.sla != null ? Math.round(p.sla) : EMPTY}</span>
              </div>
              <div className="mt-[6px]"><ProgressBar value={p.sla} label="Remediation SLA" showValue={false} /></div>
              {p.sla == null && <p className={`mt-[4px] text-ds-label ${MUTED}`}>There is no gap to remediate yet.</p>}
            </div>
          </div>
        )}
    </SectionCard>
  );
}

// ── The remediation clock of the portfolio ──────────────────────────────────────────────────────────────────────────────────

export function ClockBody({ board, points, policy, boardLoad, pointsLoad, canTune }: {
  board: Board | undefined;
  points: readonly Point[] | undefined;
  policy: Policy | undefined;
  boardLoad: Load;
  pointsLoad: Load;
  canTune: boolean;
}) {
  const [day, setDay] = useState('');
  const [tuning, setTuning] = useState(false);
  const [now] = useState(() => Date.now());
  const asOf = whatIfMs(day, now);
  const bounds = whatIfBounds(now);
  const days = daysOf(policy);
  const clock = board && points ? portfolioClock(points, days, board, asOf ?? now) : null;
  const base = board && points && asOf ? portfolioClock(points, days, board, now) : null;
  const shares = clock ? barShares(clock.aging) : [];
  const boardError = boardLoad.error ? { title: "Couldn't load the counts", message: errorMessage(boardLoad.error), onRetry: canRetry(boardLoad.error) ? boardLoad.retry : undefined } : null;
  const num = (n: number | null | undefined) => (n == null ? EMPTY : formatCount(n));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        <StatTile label="Open gaps" value={board ? num(board.sla.open) : null} loading={boardLoad.loading} error={boardError} unit={board?.sla.open === 1 ? 'gap' : 'gaps'} note={board ? `${formatCount(board.sla.gaps)} in all` : undefined} link={board ? { href: '/assessments/register?quick=overdue', label: 'Open the assessments with gaps past their date' } : undefined} />
        <StatTile label="Overdue" value={board ? num(board.sla.overdue) : null} loading={boardLoad.loading} error={boardError} tone={board && board.sla.overdue > 0 ? 'danger' : 'default'} unit="gaps" />
        <StatTile label="Due soon" value={clock ? num(clock.dueSoon) : null} loading={pointsLoad.loading} error={pointsLoad.error ? { title: "Couldn't load the dates", message: errorMessage(pointsLoad.error), onRetry: canRetry(pointsLoad.error) ? pointsLoad.retry : undefined } : null} unit="gaps" note={`within ${days.due_soon_days} days`} />
        <StatTile label="Closed" value={board ? num(board.sla.closed) : null} loading={boardLoad.loading} error={boardError} tone={board && board.sla.closed > 0 ? 'success' : 'default'} unit="gaps" />
      </div>
      <div>
        <p className={`mb-[6px] text-ds-label ${MUTED}`}>{asOf ? `Open gaps by due date if nothing is closed before ${formatDate(asOf)}` : 'Open gaps by due date'}</p>
        {pointsLoad.loading ? <SkeletonRows rows={1} columns={1} label="Loading the dates" />
          : pointsLoad.error ? errorOf("Couldn't load the dates", pointsLoad)
          : !clock ? null
          : clock.agingTotal === 0 ? <p className={`text-ds-body ${MUTED}`}>{points && points.length ? 'No open gaps.' : 'Nothing to track yet.'}</p>
          : (
            <>
              <div role="img" aria-label={clock.aging.filter((b) => b.count).map((b) => `${b.count} ${b.label.toLowerCase()}`).join(', ')} className="flex h-[12px] w-full overflow-hidden rounded-full bg-ds-border">
                {clock.aging.map((b, i) => (shares[i] ? <span key={b.key} style={{ width: `${shares[i]}%`, background: TONE[b.tone].dot }} /> : null))}
              </div>
              <ul className="mt-[8px] flex flex-wrap gap-x-[16px] gap-y-[4px]">
                {clock.aging.filter((b) => b.count > 0).map((b) => (
                  <li key={b.key} className="flex items-center gap-[6px] text-ds-label text-ds-fg-body"><span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: TONE[b.tone].dot }} />{b.label} <span className="font-[600] tabular-nums text-ds-fg">{formatCount(b.count)}</span></li>
                ))}
              </ul>
            </>
          )}
        {board && clock && clock.agingTotal > 0 && clock.agingTotal !== board.sla.open && (
          <p className={`mt-[8px] text-ds-label ${MUTED}`}>{`${formatCount(clock.agingTotal)} of the ${formatCount(board.sla.open)} open gaps are on this bar: the types that count their gaps another way (maturity scores, registers) are in the totals above, not here.`}</p>
        )}
        {asOf && base && clock && (
          <p role="status" className={`mt-[8px] text-ds-label ${MUTED}`}>{`By then ${formatCount(clock.aging[0].count)} would be past their date, ${formatCount(clock.aging[0].count - base.aging[0].count)} more than today.`}</p>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-x-[12px] gap-y-[8px] border-t border-ds-border pt-[12px]">
        <label className="flex flex-col gap-[4px] text-ds-label text-ds-fg-body">
          What if nothing is closed before
          <TextInput type="date" min={bounds.min} max={bounds.max} value={day} onChange={(e) => setDay(e.target.value)} className="w-[10.5rem]" aria-label="What if nothing is closed before this day" />
        </label>
        {day && <Button size="sm" variant="ghost" onClick={() => setDay('')}>Today</Button>}
        {canTune && <Button size="sm" className="ml-auto" leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setTuning(true)} disabled={!policy}>Tune SLA</Button>}
      </div>
      {day && asOf === null && <Notice tone="info" title="Choose a day after today">What if looks ahead, up to a year.</Notice>}
      {tuning && policy && <SlaDialog policy={policy} onClose={() => setTuning(false)} />}
    </div>
  );
}

export function EmptyOverview({ action }: { action: ReactNode }) {
  return (
    <EmptyState kind="firstUse" icon={Clock} title="No assessments yet" description="Start an assessment for an application, a function or a system, or upload a workbook from Types." action={action} />
  );
}
