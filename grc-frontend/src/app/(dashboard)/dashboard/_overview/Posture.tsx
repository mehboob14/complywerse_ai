'use client';

// Overall readiness: the one number of the page as a ring, with its grade and its distance to the target. It is NOT a score the server sends: it is the average of the scores of the
// scored areas the person can open (each counts the same), against the average of their targets, with its grade by the server's cut. The (i) says which areas went into it, how many
// scored areas the person sees of all of them and which ones did not answer, so two people never read the same number under different words; when the number rests on fewer areas than
// there are, the card says so under the ring in three words ("5 of 7 areas"). The ring opens the bars of the areas behind the number (ScoreBars). Rules and words: perfModel.ts (tested).
import { StatusPill } from '@/components/ui/ds';
import { ChartCard, ScoreRing } from '@/components/overview/charts';
import { statusPill } from '@/lib/status';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { overallDefinition, overallLeaves, vsTargetText, type Overall } from './perfModel';
import { statusOfGrade } from './perfCharts';

export function Posture({ overall }: { overall: Overall }) {
  const leaves = overallLeaves(overall);
  const state = overall.state === 'ready' ? 'ready' : overall.state === 'loading' ? 'loading' : 'empty';
  const none = overall.shown === 0 && overall.leftOut.length === 0 ? 'None of the scored areas are open to your account.' : overallDefinition(overall);
  const partial = overall.members.length < overall.of;
  return (
    <ChartCard
      id="posture"
      title="Overall readiness"
      info={`The average of the scores of the scored areas you can open, each counting the same, against the average of their targets. It is not a score the server keeps. ${overallDefinition(overall)}${leaves ? ` ${leaves.charAt(0).toUpperCase()}${leaves.slice(1)}.` : ''}`}
      state={state}
      emptyText={none}
      loadingHeight={220}
    >
      {overall.score !== null && overall.grade && (
        <div className="flex h-full flex-col items-center justify-center gap-[8px] text-center">
          <ScoreRing
            value={overall.score}
            target={overall.target}
            tone={statusOfGrade(overall.grade)}
            caption="Overall readiness"
            href="#scores"
            hrefLabel="Open the score of each area"
            below={(
              <div className="flex flex-col items-center gap-[4px]">
                <StatusPill {...statusPill(gradeStatus, overall.grade)} />
                <span className="text-ds-body text-ds-fg-body">{vsTargetText(overall.score, overall.target)}</span>
                {partial && <span className="text-ds-label text-ds-fg-muted">{`${overall.members.length} of ${overall.of} areas`}</span>}
              </div>
            )}
          />
        </div>
      )}
    </ChartCard>
  );
}
