'use client';

// The cells of the register that are about the board's numbers: the score with its word, the open and overdue gaps, the due day. Colour never carries a meaning alone: a score has its grade in
// words and a late day says "Overdue by 3 days". An assessment the board does not count shows a dash that a screen reader reads as "Not scored", never 0.
import { StatusPill } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { grade } from '@/lib/statuses/assessments';
import { gradeOf } from '@/components/assessments/workspace/workspaceModel';
import { DayCell } from '../../bcm/_register/bits';
import { isDone, type RegisterRow } from './registerConfig';

const MUTED = 'text-ds-body text-ds-fg-muted';

/** A score as the board shows it: a whole number (the server's one decimal is in the tooltip). */
export const scoreText = (score: number): string => String(Math.round(score));

export function ScoreCell({ r }: { r: RegisterRow }) {
  if (!r.entry) {
    const why = r.boardKnown ? 'The board does not score this assessment yet' : 'The score could not be loaded';
    return <span className={MUTED} title={why}><span aria-hidden>—</span><span className="sr-only">{r.boardKnown ? 'Not scored' : 'Score not available'}</span></span>;
  }
  const g = gradeOf(r.entry.content);
  if (r.entry.content === null || !g) return <span className={MUTED}>Nothing answered</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-[8px] gap-y-[2px]" title={`Score ${r.entry.content}`}>
      <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{scoreText(r.entry.content)}</span>
      <StatusPill size="sm" {...statusPill(grade, g)} />
    </span>
  );
}

export function GapsCell({ r }: { r: RegisterRow }) {
  const c = r.entry?.sla_counts;
  if (!c) return <span className={MUTED}><span aria-hidden>—</span><span className="sr-only">No gap count</span></span>;
  const open = c.open ?? 0;
  const overdue = c.overdue ?? 0;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="whitespace-nowrap text-ds-body tabular-nums text-ds-fg">{`${formatCount(open)} open`}</span>
      {overdue > 0 && <span className="truncate text-ds-label font-[600] text-ds-danger">{`${formatCount(overdue)} overdue`}</span>}
    </span>
  );
}

export function DueCell({ r, now }: { r: RegisterRow; now: number }) {
  return <DayCell value={r.due_date} now={now} noun="Due" late={!isDone(r)} />;
}
