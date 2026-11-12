'use client';

/**
 * "How is it scored?" on the Compliance Overview: the six areas behind the score, each with its weight and its formulas one press away (a dialog the person opens from the Score by area card; it is
 * open in the address, `?how=1`, so Back from a module an area opened lands in it again), and the page each area is worked on one press more. The weights are for the people who run the programme.
 */
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button, Sheet, StatusPill } from '@/components/ui/ds';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { areaBand } from '@/lib/statuses/complianceStatements';
import { GRADE_LABEL, SECTION_HREF, areaWord, type Grade } from './overviewModel';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

// ── how is it scored ─────────────────────────────────────────────────────────────────────────────────────────────────────

const TUNING = { configBase: '/compliance/policies/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.compliance] as unknown[] };

export interface AreasSheetProps {
  open: boolean;
  onClose: () => void;
  sections: OverviewSection[];
  score: number | null;
  grade: Grade | null;
  /** administrators only: the server lets any signed-in person move the weights, the screen offers them to the people who run the programme */
  canTune: boolean;
}

/** The six areas behind the score, each with its weight and its formulas one press away; the page each is worked on is one press more. */
export function AreasSheet({ open, onClose, sections, score, grade, canTune }: AreasSheetProps) {
  const [section, setSection] = useState<OverviewSection | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const close = () => { setAdjusting(false); onClose(); };
  return (
    <>
      <Sheet open={open} onClose={close} title="How the score is made" subtitle={score == null ? 'No score yet' : `Score ${score}${grade ? ` · ${GRADE_LABEL[grade]}` : ''}`} width="md">
        {adjusting ? (
          <SectionWeightTuner sections={sections} configBase={TUNING.configBase} invalidateKey={TUNING.invalidateKey} onClose={() => setAdjusting(false)} />
        ) : (
          <>
            <p className="mt-0 text-ds-body text-ds-fg-muted">The score is the weighted mean of the areas that have data. Press an area for its formulas.</p>
            <ul className="m-0 list-none p-0">
              {sections.map((s) => {
                const word = areaWord(s.score);
                return (
                  <li key={s.key} className="flex min-h-ds-control items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
                    <button type="button" onClick={() => setSection(s)} className={`min-w-0 flex-1 rounded-ds-control text-left hover:underline ${FOCUS}`}>
                      <span className="block truncate text-ds-body font-[500] text-ds-fg" title={s.label}>{s.label}</span>
                      <span className="text-ds-label text-ds-fg-muted">{`${Math.round(s.weight * 100)}% of the score`}</span>
                    </button>
                    <span className="tabular-nums text-ds-body text-ds-fg">{s.score == null ? '—' : Math.round(s.score)}</span>
                    <StatusPill size="sm" tone={areaBand.tone(word)} label={areaBand.label(word)} />
                    <Button size="sm" href={SECTION_HREF[s.key] ?? '/compliance'} aria-label={`Open ${s.label}`}>Open</Button>
                  </li>
                );
              })}
            </ul>
            {canTune && <div className="mt-[12px]"><Button leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setAdjusting(true)}>Adjust section weights</Button></div>}
          </>
        )}
      </Sheet>
      <SectionDetailModal section={section} onClose={() => setSection(null)} tuning={canTune ? TUNING : undefined} />
    </>
  );
}
