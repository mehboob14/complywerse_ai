'use client';

/**
 * The module score of the Issue & Incident Overview as a graphic card (Overview v2): the ring in the server's grade colour (the grade as a word beside it, the target it was scored against), the three
 * sections it is made of as bars, and "How is it scored?" which opens the Module score sheet (the math, and the weights for the people who could always adjust them; the sheet is kept in the address:
 * `?score=1`). The card loads, fails (with Retry), is refused ("No access") or has nothing on its own: a failed request is said where the score would be, never drawn as a score of 0.
 */
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button, ProgressBar, Sheet, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { ChartCard, ScoreRing, type ChartCardProps } from '@/components/overview/charts';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { EMPTY } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { gradeStatus } from '@/lib/statuses/dashboard';
import type { Grade, Posture, SectionRow } from './overviewModel';
import type { FeedStatus } from './v2Model';

export interface ScoreCardProps {
  feed: FeedStatus;
  posture: Posture;
  sections: SectionRow[];
  onOpen: () => void;
}

/** The ring's colour is the server's grade (excellent and good green, fair amber, poor red); with none it is the neutral blue. */
const RING_TONE: Record<Grade | 'none', 'good' | 'warn' | 'bad' | 'progress'> = { excellent: 'good', good: 'good', fair: 'warn', poor: 'bad', none: 'progress' };

function stateOf({ feed, posture, sections }: ScoreCardProps): Pick<ChartCardProps, 'state' | 'error' | 'deniedText'> {
  if (!feed.hasData && feed.isPending) return { state: 'loading' };
  if (!feed.hasData && feed.isError) {
    if (statusOf(feed.error) === 403) return { state: 'denied', deniedText: 'Your role cannot see the score.' };
    return { state: 'error', error: { title: "Couldn't load the score", message: errorMessage(feed.error), onRetry: canRetry(feed.error) ? () => { void feed.refetch(); } : undefined } };
  }
  return { state: posture.score === null && sections.length === 0 ? 'empty' : 'ready' };
}

export function ScoreCard(props: ScoreCardProps) {
  const { posture, sections, onOpen } = props;
  return (
    <ChartCard
      id="score" title="Issue and incident score" loadingHeight={220} emptyText="No score yet. It appears once there are issues, incidents or corrective actions to score."
      info="The weighted mean of three sections (issues, incidents and corrective actions), worked out by the server from the whole register. The target is the one your organisation scores against."
      actions={<Button variant="link" size="sm" leftIcon={<SlidersHorizontal aria-hidden />} onClick={onOpen}>How is it scored?</Button>}
      {...stateOf(props)}
    >
      <ScoreRing
        value={posture.score} target={posture.target} tone={RING_TONE[posture.grade ?? 'none']} caption="Issue and incident score" size={104}
        below={(
          <div className="flex flex-wrap items-center justify-center gap-[6px]">
            {posture.grade && <StatusPill {...statusPill(gradeStatus, posture.grade)} />}
            {posture.target !== null && posture.score !== null && <span className="text-ds-label text-ds-fg-muted">{`Target ${posture.target}`}</span>}
          </div>
        )}
      />
      <ul className="m-0 mt-[8px] list-none p-0">
        {sections.map((s) => (
          <li key={s.key} className="flex min-h-[32px] items-center gap-[8px] border-t border-ds-border py-[2px]">
            <span className="min-w-0 flex-1 truncate text-ds-body text-ds-fg-body" title={s.label}>{s.label}</span>
            <ProgressBar className="w-[64px] shrink-0" value={s.score} label={`${s.label} score`} showValue={false} tone={s.grade === 'poor' ? 'danger' : s.grade === 'fair' ? 'warning' : 'success'} />
            <span className="w-[3ch] shrink-0 text-right tabular-nums text-ds-body text-ds-fg">{s.score === null ? EMPTY : Math.round(s.score)}</span>
            {s.grade ? <StatusPill size="sm" {...statusPill(gradeStatus, s.grade)} /> : <StatusPill size="sm" tone="neutral" label="No data" />}
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

const TUNING = { configBase: '/issue-management/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.issues] as unknown[] };

/** The three sections behind the score, each with its weight and the math one press away (the shared formulas dialog, with the per-metric weights); the section weights and the target are adjusted here. */
export function ScoreSheet({ open, onClose, sections, posture }: { open: boolean; onClose: () => void; sections: OverviewSection[]; posture: Posture }) {
  const [section, setSection] = useState<OverviewSection | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const close = () => { setAdjusting(false); onClose(); };
  return (
    <>
      <Sheet open={open} onClose={close} title="How the score is worked out" subtitle={posture.score === null ? 'No score yet' : `Score ${posture.score}${posture.grade ? ` · ${gradeStatus.label(posture.grade)}` : ''}`} width="md">
        {adjusting ? (
          <SectionWeightTuner sections={sections} configBase={TUNING.configBase} invalidateKey={TUNING.invalidateKey} onClose={() => setAdjusting(false)} />
        ) : (
          <>
            <p className="mb-[8px] mt-0 text-ds-body text-ds-fg-muted">The score is the weighted mean of the sections that have data. Press a section for its metrics and formulas.</p>
            <ul className="m-0 list-none p-0">
              {sections.map((s) => (
                <li key={s.key} className="flex min-h-ds-control items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                  <button type="button" onClick={() => setSection(s)} className="min-w-0 flex-1 rounded-ds-control text-left hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                    <span className="block truncate text-ds-body font-[500] text-ds-fg" title={s.label}>{s.label}</span>
                    <span className="text-ds-label text-ds-fg-muted">{Math.round(s.weight * 100)}% of the score</span>
                  </button>
                  <span className="tabular-nums text-ds-body text-ds-fg">{s.score === null ? EMPTY : Math.round(s.score)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-[12px]"><Button leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setAdjusting(true)}>Adjust section weights</Button></div>
          </>
        )}
      </Sheet>
      <SectionDetailModal section={section} onClose={() => setSection(null)} tuning={TUNING} />
    </>
  );
}
