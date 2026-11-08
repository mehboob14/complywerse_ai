'use client';

// Overall readiness: the one number of the page, and what it is. It is NOT a score the server sends: it is the average of the scores of the scored areas the person can open (each
// counts the same), against the average of their targets, with its grade by the server's cut. The card says which areas went into it, how many scored areas the person sees of all
// of them and which ones did not answer, so two people never read the same number under different words. Rules and words: perfModel.ts (tested).
import { Button, ProgressBar, SectionCard, Skeleton, StatusPill, type ProgressTone } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { gradeOf, type Grade } from '@/lib/perf/moduleFeeds';
import { Loading } from './parts';
import { overallDefinition, overallLeaves, vsTargetText, type Overall } from './perfModel';

const TONE: Record<Grade, ProgressTone> = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' };
const FILL: Record<ProgressTone, string> = { primary: 'bg-ds-primary', success: 'bg-ds-success', warning: 'bg-ds-warning', danger: 'bg-ds-danger' };

export function Posture({ overall }: { overall: Overall }) {
  const leaves = overallLeaves(overall);
  const members = overall.members.slice().sort((a, b) => a.score - b.score);
  return (
    <SectionCard
      id="posture"
      title="Overall readiness"
      info="The average of the scores of the scored areas you can open, each counting the same, against the average of their targets. It is not a score the server keeps: the areas that went into it are named below."
      actions={<Button size="sm" href="#modules">See each area</Button>}
    >
      {overall.state === 'loading' && (
        <Loading label="Loading overall readiness">
          <Skeleton className="h-[36px] w-[96px]" />
          <Skeleton className="mt-[12px] h-[8px] w-full" />
          <Skeleton className="mt-[12px] h-[16px] w-[80%]" />
        </Loading>
      )}
      {overall.state === 'none' && (
        <p className="text-ds-body text-ds-fg-muted">
          {overall.shown === 0 && overall.leftOut.length === 0 ? 'None of the scored areas are open to your account.' : overallDefinition(overall)}
          {leaves ? ` ${leaves.charAt(0).toUpperCase()}${leaves.slice(1)}.` : ''}
        </p>
      )}
      {overall.state === 'ready' && overall.score !== null && overall.grade && (
        <div>
          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
            <span className="text-[32px] font-[600] leading-[1.1] tabular-nums text-ds-fg">{overall.score}</span>
            <StatusPill {...statusPill(gradeStatus, overall.grade)} />
            <span className="text-ds-body text-ds-fg-muted">{vsTargetText(overall.score, overall.target)}</span>
          </div>
          <ProgressBar value={overall.score} label="Overall readiness" showValue={false} tone={TONE[overall.grade]} className="mt-[12px]" />
          <p className="mt-[12px] text-ds-body text-ds-fg-body">{overallDefinition(overall)}</p>
          <p className="mt-[4px] text-ds-label text-ds-fg-muted">{`${overall.atTarget} of ${overall.members.length} are at or above their target.`}</p>
          {leaves && <p className="mt-[4px] text-ds-label text-ds-fg-muted">{`${leaves.charAt(0).toUpperCase()}${leaves.slice(1)}.`}</p>}
          {/* the areas behind the number, weakest first (plain rows: the table below is where each one opens) */}
          <ul className="m-0 mt-[12px] list-none border-t border-ds-border p-0 pt-[4px]">
            {members.map((m) => (
              <li key={m.key}>
                <div className="flex min-h-[28px] items-center gap-[8px] px-[4px] text-ds-body">
                  <span className="min-w-0 flex-1 break-words text-ds-fg">{m.label}</span>
                  <span aria-hidden className="h-[6px] w-[64px] shrink-0 rounded-full bg-ds-border"><span className={`block h-[6px] rounded-full ${FILL[TONE[gradeOf(m.score) ?? 'poor']]}`} style={{ width: `${Math.max(4, Math.min(100, m.score))}%` }} /></span>
                  <span className="w-[32px] shrink-0 text-right tabular-nums text-ds-fg">{Math.round(m.score)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
